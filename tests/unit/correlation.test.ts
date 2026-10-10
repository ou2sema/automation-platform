import { describe, expect, it } from "vitest";

import {
  createId,
  createRunId,
  getCorrelation,
  mergeCorrelation,
  runWithin,
  withCorrelation,
  withRootCorrelation,
  type CorrelationOverlay,
} from "../../src/index.js";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("correlation identifiers", () => {
  it("prefixes identifiers so logs are readable", () => {
    expect(createId("job")).toMatch(/^job-[0-9a-f-]{8}$/);
    expect(createId("job")).not.toBe(createId("job"));
  });

  it("slugifies the run label", () => {
    expect(createRunId("Nightly Regression!")).toMatch(/^run-nightly-regression-[0-9a-f-]{8}$/);
  });

  it("omits an absent label", () => {
    expect(createRunId()).toMatch(/^run-[0-9a-f-]{8}$/);
  });
});

describe("mergeCorrelation", () => {
  it("ignores undefined overlay values instead of erasing an established id", () => {
    // Built as a literal and widened, because `exactOptionalPropertyTypes` forbids
    // writing `{ jobId: undefined }` directly against the overlay type.
    const sloppy = { jobId: undefined, scenarioId: "s2" } as unknown as CorrelationOverlay;
    const merged = mergeCorrelation({ runId: "r1", scenarioId: "s1" }, sloppy);

    expect(merged).toEqual({ runId: "r1", scenarioId: "s2" });
    expect("jobId" in merged).toBe(false);
  });

  it("refuses to build a correlation without a runId", () => {
    expect(() => mergeCorrelation(undefined, { jobId: "j1" })).toThrow(/requires runId/);
  });
});

describe("runWithin", () => {
  it("seeds the chain from an explicit base", async () => {
    const seen = await runWithin({ runId: "r1", scenarioId: "s1" }, { jobId: "j1" }, () =>
      getCorrelation(),
    );

    expect(seen).toEqual({ runId: "r1", scenarioId: "s1", jobId: "j1" });
  });

  it("clears the ambient scope when the boundary exits", async () => {
    await runWithin({ runId: "r1" }, { jobId: "j1" }, () => undefined);
    expect(getCorrelation()).toBeUndefined();
  });

  it("nests action spans on top of job spans", async () => {
    const seen = await runWithin({ runId: "r1", scenarioId: "s1" }, { jobId: "j1" }, async () =>
      withCorrelation({ actionId: "a1" }, () => getCorrelation()),
    );

    expect(seen).toEqual({ runId: "r1", scenarioId: "s1", jobId: "j1", actionId: "a1" });
  });

  it("keeps concurrently running scenarios isolated from each other", async () => {
    const [first, second] = await Promise.all([
      runWithin({ runId: "run-a", scenarioId: "scen-a" }, { jobId: "job-a" }, async () => {
        await delay(10);
        return getCorrelation();
      }),
      runWithin({ runId: "run-b", scenarioId: "scen-b" }, { jobId: "job-b" }, async () => {
        await delay(1);
        return getCorrelation();
      }),
    ]);

    // Without async-local isolation the faster span would leak into the slower one.
    expect(first).toEqual({ runId: "run-a", scenarioId: "scen-a", jobId: "job-a" });
    expect(second).toEqual({ runId: "run-b", scenarioId: "scen-b", jobId: "job-b" });
  });

  it("propagates into awaited work but not after it", async () => {
    let inside = "";
    await withRootCorrelation({ runId: "root" }, async () => {
      await delay(1);
      inside = getCorrelation()?.runId ?? "";
    });

    expect(inside).toBe("root");
    expect(getCorrelation()).toBeUndefined();
  });

  it("withCorrelation refuses to invent a run when no scope exists", async () => {
    await expect(withCorrelation({ jobId: "j1" }, () => undefined)).rejects.toThrow(
      /Correlation requires runId/,
    );
  });
});
