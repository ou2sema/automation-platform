import { describe, expect, it } from "vitest";

import {
  AssertionFailedError,
  BrowserLifecycleError,
  ConfigurationError,
  isPlatformError,
  PlatformError,
  PlatformErrorCode,
  toErrorReport,
} from "../../src/index.js";

describe("PlatformError", () => {
  it("applies critical, non-retryable defaults", () => {
    const error = new PlatformError(PlatformErrorCode.UNKNOWN_ERROR, "boom");

    expect(error.severity).toBe("critical");
    expect(error.retryable).toBe(false);
    expect(error.context).toEqual({});
    expect(error.name).toBe("PlatformError");
    expect(isPlatformError(error)).toBe(true);
  });

  it("keeps the original error as an inspectable cause", () => {
    const cause = new Error("socket hang up");
    const error = new PlatformError(PlatformErrorCode.NAVIGATION_FAILED, "cannot load", {
      cause,
    });

    expect(error.cause).toBe(cause);
  });

  it("subclasses report their specific name and code", () => {
    expect(new ConfigurationError("bad").code).toBe(PlatformErrorCode.CONFIGURATION_INVALID);
    expect(new ConfigurationError("bad").name).toBe("ConfigurationError");
    expect(new AssertionFailedError("bad").code).toBe(PlatformErrorCode.ASSERTION_FAILED);
    expect(new BrowserLifecycleError(PlatformErrorCode.BROWSER_LAUNCH_FAILED, "bad").code).toBe(
      PlatformErrorCode.BROWSER_LAUNCH_FAILED,
    );
  });
});

describe("toErrorReport", () => {
  it("classifies a plain Error as UNKNOWN_ERROR instead of discarding it", () => {
    const report = toErrorReport(new TypeError("x is not a function"));

    expect(report.code).toBe(PlatformErrorCode.UNKNOWN_ERROR);
    expect(report.name).toBe("TypeError");
    expect(report.message).toBe("x is not a function");
  });

  it("handles a thrown non-Error value", () => {
    const report = toErrorReport("exploded");

    expect(report.code).toBe(PlatformErrorCode.UNKNOWN_ERROR);
    expect(report.message).toContain('"exploded"');
    expect(report.context.thrownType).toBe("string");
  });

  it("serialises a nested cause chain", () => {
    const inner = new PlatformError(PlatformErrorCode.OPERATION_TIMEOUT, "timed out", {
      retryable: true,
    });
    const outer = new PlatformError(PlatformErrorCode.BROWSER_CLOSE_FAILED, "close failed", {
      cause: inner,
      context: { browserName: "chromium" },
    });

    const report = toErrorReport(outer);
    expect(report.context.browserName).toBe("chromium");
    expect(report.cause?.code).toBe(PlatformErrorCode.OPERATION_TIMEOUT);
    expect(report.cause?.retryable).toBe(true);
  });

  it("produces a JSON-safe structure for reporters and event payloads", () => {
    const report = toErrorReport(
      new PlatformError(PlatformErrorCode.ASSERTION_FAILED, "mismatch", {
        severity: "warning",
        context: { expected: 1, actual: 2 },
      }),
    );

    expect(() => JSON.stringify(report)).not.toThrow();
    const round = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(round.severity).toBe("warning");
    expect(round.context).toEqual({ expected: 1, actual: 2 });
  });

  it("terminates on a circular cause chain and marks the loop", () => {
    const error = new Error("loop");
    const wrapper = new PlatformError(PlatformErrorCode.UNKNOWN_ERROR, "wrapper", {
      cause: error,
    });
    error.cause = wrapper;

    const report = toErrorReport(wrapper);
    expect(report.cause?.message).toBe("loop");
    expect(report.cause?.cause?.context.circular).toBe(true);
    expect(report.cause?.cause?.message).toContain("circular reference");
  });

  it("describes a null-prototype thrown object without crashing", () => {
    const report = toErrorReport(Object.create(null));

    expect(report.message).toContain("object (no prototype)");
    expect(report.context.thrownType).toBe("object");
  });
});
