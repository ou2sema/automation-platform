import { PlatformError, PlatformErrorCode } from "../errors/index.js";

/**
 * Bound an operation that has no native timeout.
 *
 * Several Playwright and provider APIs accept no timeout, or had their timeout
 * option removed; an unbounded await can hang a suite indefinitely. This helper
 * keeps the configured timeout authoritative at the call site.
 *
 * Note: racing does not cancel the underlying operation. The abandoned promise is
 * observed so a late rejection cannot surface as an unhandled rejection.
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new PlatformError(
            PlatformErrorCode.OPERATION_TIMEOUT,
            `${description} did not finish within ${String(timeoutMs)}ms.`,
            { context: { timeoutMs, description }, retryable: true },
          ),
        ),
      timeoutMs,
    );
    timer.unref();
  });

  // Observe the loser of the race so a late rejection is never unhandled.
  operation.catch(() => undefined);

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
