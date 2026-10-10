import { describe, expect, it } from "vitest";

import {
  PlatformEventBus,
  withRootCorrelation,
  type CorrelationIds,
  type EventEnvelope,
  type PlatformEventType,
} from "../../src/index.js";

import { makeTestLogger } from "./helpers/logger.js";

const runId = "run-test";

function makeBus(options: { readonly maxPending?: number; readonly flushTimeoutMs?: number } = {}) {
  const { logger, sink } = makeTestLogger({ level: "debug" });
  const bus = new PlatformEventBus({
    runId,
    logger,
    ...("maxPending" in options ? { maxPending: options.maxPending } : {}),
    ...("flushTimeoutMs" in options ? { flushTimeoutMs: options.flushTimeoutMs } : {}),
  });
  return { bus, sink };
}

const payload = { label: "events-test", configuration: {} } as const;

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((inner) => {
    resolve = inner;
  });
  return { promise, resolve };
}

describe("PlatformEventBus delivery", () => {
  it("delivers an envelope to a subscriber and counts it", async () => {
    const { bus } = makeBus();
    const seen: EventEnvelope<"run.started">[] = [];
    bus.on("run.started", (envelope) => {
      seen.push(envelope);
    });

    bus.emit("run.started", payload);
    await bus.flush();

    expect(bus.stats()).toMatchObject({ emitted: 1, delivered: 1, failed: 0, dropped: 0 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe("run.started");
    expect(seen[0]?.payload.label).toBe("events-test");
    expect(seen[0]?.source).toBe("automation-platform");
    expect(seen[0]?.emittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not count an event with no subscribers as delivered", async () => {
    const { bus } = makeBus();
    bus.emit("run.started", payload);
    await bus.flush();

    expect(bus.stats()).toEqual({ emitted: 1, delivered: 0, failed: 0, dropped: 0 });
  });

  it("delivers only to the matching event type", async () => {
    const { bus } = makeBus();
    const finished: string[] = [];
    bus.on("scenario.finished", (envelope) => {
      finished.push(envelope.payload.scenarioName);
    });

    bus.emit("run.started", payload);
    bus.emit("scenario.finished", {
      scenarioName: "orders",
      status: "passed",
      durationMs: 12,
      artifactPaths: [],
    });
    await bus.flush();

    expect(finished).toEqual(["orders"]);
    expect(bus.stats()).toMatchObject({ emitted: 2, delivered: 1 });
  });

  it("stops delivering after unsubscribe", async () => {
    const { bus } = makeBus();
    let calls = 0;
    const off = bus.on("run.started", () => {
      calls += 1;
    });

    bus.emit("run.started", payload);
    await bus.flush();
    off();
    bus.emit("run.started", payload);
    await bus.flush();

    expect(calls).toBe(1);
  });

  it("runs several subscribers for one event in registration order", async () => {
    const { bus } = makeBus();
    const order: string[] = [];
    bus.on("run.started", () => {
      order.push("first");
    });
    bus.on("run.started", () => {
      order.push("second");
    });

    bus.emit("run.started", payload);
    await bus.flush();

    expect(order).toEqual(["first", "second"]);
  });
});

describe("PlatformEventBus correlation", () => {
  it("falls back to the run identifier when nothing is in scope", async () => {
    const { bus } = makeBus();
    const seen: CorrelationIds[] = [];
    bus.on("run.started", (envelope) => {
      seen.push(envelope.correlation);
    });

    bus.emit("run.started", payload);
    await bus.flush();

    expect(seen).toEqual([{ runId }]);
  });

  it("captures the ambient correlation at emit time", async () => {
    const { bus } = makeBus();
    const seen: CorrelationIds[] = [];
    bus.on("scenario.started", (envelope) => {
      seen.push(envelope.correlation);
    });

    await withRootCorrelation({ runId, scenarioId: "scenario-1", jobId: "job-1" }, async () => {
      bus.emit("scenario.started", {
        scenarioName: "orders",
        uri: "features/orders.feature",
        tags: ["@ui"],
      });
      await bus.flush();
    });

    expect(seen).toEqual([{ runId, scenarioId: "scenario-1", jobId: "job-1" }]);
  });

  it("prefers an explicitly supplied correlation over the ambient one", async () => {
    const { bus } = makeBus();
    const seen: CorrelationIds[] = [];
    bus.on("run.started", (envelope) => {
      seen.push(envelope.correlation);
    });

    await withRootCorrelation({ runId, scenarioId: "ambient" }, async () => {
      bus.emit("run.started", payload, { runId, scenarioId: "explicit" });
      await bus.flush();
    });

    expect(seen).toEqual([{ runId, scenarioId: "explicit" }]);
  });

  it("snapshots correlation when the event is emitted, not when it is delivered", async () => {
    const { bus } = makeBus();
    const blocker = deferred();
    const seen: EventEnvelope<"run.started">[] = [];
    bus.on("run.started", async (envelope) => {
      seen.push(envelope);
      await blocker.promise;
    });

    await withRootCorrelation({ runId, scenarioId: "emit-scope" }, () => {
      bus.emit("run.started", payload);
    });

    // The emitting scope has closed; delivery completes under a different one.
    await withRootCorrelation({ runId, scenarioId: "delivery-scope" }, async () => {
      blocker.resolve();
      await bus.flush();
    });

    expect(seen[0]?.correlation).toEqual({ runId, scenarioId: "emit-scope" });
  });
});

describe("PlatformEventBus failure isolation", () => {
  it("keeps executing later subscribers when one throws, and records the failure", async () => {
    const { bus, sink } = makeBus();
    const reached: string[] = [];
    bus.on("run.started", () => {
      throw new Error("subscriber exploded");
    });
    bus.on("run.started", () => {
      reached.push("second");
    });

    bus.emit("run.started", payload);
    await bus.flush();

    expect(reached).toEqual(["second"]);
    expect(bus.stats()).toMatchObject({ emitted: 1, delivered: 1, failed: 1 });
    const logged = sink.find("Event subscriber failed");
    expect(logged?.level).toBe("error");
    expect(logged?.record.error).toMatchObject({ message: "subscriber exploded" });
  });

  it("treats a rejecting subscriber as a delivery failure, not a thrown one", async () => {
    const { bus, sink } = makeBus();
    bus.on("run.started", () => Promise.reject(new Error("async subscriber exploded")));

    expect(() => bus.emit("run.started", payload)).not.toThrow();
    await bus.flush();

    expect(bus.stats()).toMatchObject({ failed: 1 });
    expect(sink.find("Event subscriber failed")?.record.error).toMatchObject({
      message: "async subscriber exploded",
    });
  });
});

describe("PlatformEventBus flushing and back-pressure", () => {
  it("waits for slow subscribers to settle", async () => {
    const { bus } = makeBus();
    let finished = false;
    bus.on("run.started", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
    });

    bus.emit("run.started", payload);
    await bus.flush();

    expect(finished).toBe(true);
  });

  it("returns after the bounded timeout when a subscriber never settles", async () => {
    const { bus, sink } = makeBus({ flushTimeoutMs: 10 });
    const blocker = deferred();
    bus.on("run.started", () => blocker.promise);

    bus.emit("run.started", payload);
    await expect(bus.flush()).resolves.toBeUndefined();

    expect(sink.find("did not finish before the flush timeout")?.level).toBe("warn");

    // Release the subscriber so no delivery outlives the test.
    blocker.resolve();
    await bus.flush();
  });

  it("drops events under real pressure, then accepts them again once deliveries settle", async () => {
    const { bus, sink } = makeBus({ maxPending: 1 });
    const blocker = deferred();
    let released = false;
    bus.on("run.started", async () => {
      await blocker.promise;
      released = true;
    });

    bus.emit("run.started", payload);
    expect(bus.stats()).toMatchObject({ emitted: 1, dropped: 0 });

    bus.emit("run.started", payload);
    expect(bus.stats()).toMatchObject({ emitted: 2, dropped: 1 });
    expect(sink.find("queue is saturated")?.level).toBe("warn");

    blocker.resolve();
    await bus.flush();
    expect(released).toBe(true);

    // Regression guard: the queue must measure in-flight work, not cumulative
    // history, or a long suite would end up dropping every event.
    bus.emit("run.started", payload);
    await bus.flush();

    expect(bus.stats()).toEqual({ emitted: 3, delivered: 2, failed: 0, dropped: 1 });
  });

  it("drops events emitted after close", async () => {
    const { bus } = makeBus();
    let calls = 0;
    bus.on("run.started", () => {
      calls += 1;
    });

    bus.emit("run.started", payload);
    await bus.close();
    bus.emit("run.started", payload);

    expect(calls).toBe(1);
    expect(bus.stats()).toMatchObject({ emitted: 1, delivered: 1, dropped: 1 });
  });

  it("drains work queued before close", async () => {
    const { bus } = makeBus();
    let finished = false;
    bus.on("run.started", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      finished = true;
    });

    bus.emit("run.started", payload);
    await bus.close();

    expect(finished).toBe(true);
  });
});

describe("PlatformEventBus typing", () => {
  it("exposes a catalogue-driven event type without widening payloads", () => {
    const types: PlatformEventType[] = [
      "run.started",
      "run.finished",
      "scenario.started",
      "scenario.finished",
      "browser.launched",
      "browser.context.created",
      "browser.context.closed",
      "failure.recorded",
    ];
    expect(new Set(types).size).toBe(types.length);
  });
});
