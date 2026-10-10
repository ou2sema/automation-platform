import { describe, expect, it } from "vitest";

import {
  isPlatformError,
  PlatformErrorCode,
  withTimeout,
  type PlatformError,
} from "../../src/index.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(
    () => undefined,
    (cause: unknown) => cause,
  );
}

describe("withTimeout", () => {
  it("returns the operation result when it finishes in time", async () => {
    await expect(withTimeout(Promise.resolve("done"), 1_000, "quick operation")).resolves.toBe(
      "done",
    );
  });

  it("propagates the operation's own failure when it fails first", async () => {
    const failure = await captureRejection(
      withTimeout(Promise.reject(new Error("the operation itself failed")), 1_000, "failing"),
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("the operation itself failed");
  });

  it("rejects with a retryable timeout error carrying the call-site description", async () => {
    const failure = (await captureRejection(
      withTimeout(delay(200), 5, "browser close"),
    )) as PlatformError;

    expect(isPlatformError(failure)).toBe(true);
    expect(failure.code).toBe(PlatformErrorCode.OPERATION_TIMEOUT);
    expect(failure.message).toContain("browser close did not finish within 5ms");
    expect(failure.retryable).toBe(true);
    expect(failure.context).toEqual({ timeoutMs: 5, description: "browser close" });
  });

  it("does not let a late rejection surface as an unhandled rejection", async () => {
    const seen: unknown[] = [];
    const observe = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on("unhandledRejection", observe);

    // Racing cannot cancel the loser, so it rejects only after the timeout fired.
    const slow = new Promise<void>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error("late failure"));
      }, 20);
    });

    await captureRejection(withTimeout(slow, 5, "slow operation"));
    await delay(60);
    process.off("unhandledRejection", observe);

    expect(seen).toEqual([]);
  });
});
