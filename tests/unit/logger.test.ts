import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  createLogger,
  PlatformError,
  PlatformErrorCode,
  runWithin,
  type LogContext,
} from "../../src/index.js";
import { makeConfiguration } from "./helpers/configuration.js";
import { makeTestLogger } from "./helpers/logger.js";

describe("structured logging", () => {
  it("emits the static correlation on every record", () => {
    const { logger, sink } = makeTestLogger({
      staticCorrelation: { runId: "r1", scenarioId: "s1" },
    });
    logger.info("hello", { detail: 1 });

    const record = sink.records[0];
    expect(record?.message).toBe("hello");
    expect(record?.record).toMatchObject({ runId: "r1", scenarioId: "s1", detail: 1 });
  });

  it("merges the ambient job span into records taken inside it", async () => {
    const { logger, sink } = makeTestLogger({
      staticCorrelation: { runId: "r1", scenarioId: "s1" },
    });

    await runWithin({ runId: "r1", scenarioId: "s1" }, { jobId: "j1" }, () => {
      logger.info("inside job");
    });
    logger.info("outside job");

    expect(sink.records[0]?.record.jobId).toBe("j1");
    expect(sink.records[1]?.record.jobId).toBeUndefined();
  });

  it("filters below the configured level", () => {
    const { logger, sink } = makeTestLogger({ level: "warn" });
    logger.debug("drop me");
    logger.info("drop me too");
    logger.warn("keep me");
    logger.error("keep me");

    expect(sink.records.map((record) => record.message)).toEqual(["keep me", "keep me"]);
  });

  it("carries child bindings without losing the parent correlation", () => {
    const { logger, sink } = makeTestLogger({
      staticCorrelation: { runId: "r1", scenarioId: "s1" },
    });
    logger.child({ scenarioName: "Checkout works" }).info("child record");

    expect(sink.records[0]?.record).toMatchObject({
      scenarioName: "Checkout works",
      runId: "r1",
      scenarioId: "s1",
    });
  });

  it("normalises any thrown value into the standard error report", () => {
    const { logger, sink } = makeTestLogger();
    logger.errorFrom(
      new PlatformError(PlatformErrorCode.OPERATION_TIMEOUT, "too slow", { retryable: true }),
      "operation failed",
    );

    const record: LogContext | undefined = sink.records[0]?.record;
    const error = record?.error as { code: string; retryable: boolean } | undefined;
    expect(error?.code).toBe(PlatformErrorCode.OPERATION_TIMEOUT);
    expect(error?.retryable).toBe(true);
  });

  it("lets a caller-supplied context value win over a stale binding", () => {
    const { logger, sink } = makeTestLogger({ level: "debug" });
    logger.child({ attempt: 1 }).debug("retrying", { attempt: 2 });

    expect(sink.records[0]?.record.attempt).toBe(2);
  });

  it("find() locates records by message fragment", () => {
    const { logger, sink } = makeTestLogger();
    logger.info("browser process ready");

    expect(sink.find("process")?.level).toBe("info");
    expect(sink.find("nothing here")).toBeUndefined();
  });
});

describe("redaction at the transport boundary", () => {
  it("removes secret paths from the bytes pino actually writes", () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });

    const config = makeConfiguration({ AP_AI_API_KEY: "must-never-be-written" });
    const logger = createLogger(config, { runId: "r1", scenarioId: "s1" }, stream);

    // A caller that hands the secrets node over as context is the exact case the
    // transport has to defend against.
    logger.info("launching browser", {
      secrets: { aiApiKey: "must-never-be-written", n8nWebhookToken: "also-secret" },
      browserName: "chromium",
    });

    const output = chunks.join("");
    expect(output).toContain("launching browser");
    expect(output).toContain("chromium");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("must-never-be-written");
    expect(output).not.toContain("also-secret");
    expect(output).toContain('"runId":"r1"');
  });
});
