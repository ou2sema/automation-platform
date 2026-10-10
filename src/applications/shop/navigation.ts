import type { Locator, Page } from "playwright";

import { PlatformError, PlatformErrorCode } from "../../platform/errors/index.js";
import { isShopRoute, type ShopRoute } from "./configuration.js";

const SHOP_PAGE = "[data-testid='shop-page']";

/**
 * Route observation, ambiguity guards and outcome racing.
 *
 * These are shared by the page objects as plain functions rather than a base class:
 * composition over inheritance, and each page stays honest about which helpers it uses.
 *
 * `requireOne` is the load-bearing safety rule. When a locator matches more than one
 * element the platform refuses to pick one, because acting on a guessed element can
 * produce a green run that never exercised the intended control.
 */
export async function readRoute(page: Page): Promise<ShopRoute | null> {
  const value = await page.locator(SHOP_PAGE).getAttribute("data-route");
  return isShopRoute(value) ? value : null;
}

export async function waitForRoute(page: Page, route: ShopRoute, timeoutMs: number): Promise<void> {
  await page
    .locator(`${SHOP_PAGE}[data-route='${route}']`)
    .waitFor({ state: "attached", timeout: timeoutMs });
}

export async function requireOne(locator: Locator, description: string): Promise<void> {
  const count = await locator.count();

  if (count === 0) {
    throw new PlatformError(
      PlatformErrorCode.ELEMENT_NOT_FOUND,
      `No element matched ${description}.`,
      { context: { description, count }, retryable: true },
    );
  }

  if (count > 1) {
    throw new PlatformError(
      PlatformErrorCode.ELEMENT_AMBIGUOUS,
      `${description} matched ${String(count)} elements; refusing to choose one.`,
      { severity: "critical", context: { description, count } },
    );
  }
}

export interface OutcomeSignal<T> {
  readonly value: T;
  readonly promise: Promise<unknown>;
}

/**
 * Wait for whichever determinate outcome happens first.
 *
 * This exists because a negative expectation cannot be expressed as "wait until the
 * positive one times out". A rejected sign-in and a refused checkout are both real,
 * observable results that arrive in well under a second; treating them as the absence of
 * success meant every negative scenario burned the full navigation timeout and then
 * surfaced as a generic step timeout instead of a business result.
 *
 * Only the first *fulfilled* signal wins. A signal that rejects (its element never
 * appeared, its route never attached) is not an outcome, and losing does not fail the
 * operation. If nothing fulfils before the deadline the caller gets `null` and must report
 * the state as unknown rather than guess.
 */
export async function firstFulfilled<T>(
  candidates: readonly OutcomeSignal<T>[],
  timeoutMs: number,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(null), timeoutMs);

    function finish(value: T | null): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }

    for (const candidate of candidates) {
      // Each promise gets a rejection handler, so a losing signal that rejects cannot
      // surface as an unhandled rejection elsewhere in the run.
      candidate.promise.then(
        () => finish(candidate.value),
        () => undefined,
      );
    }
  });
}

/**
 * Describe where the browser is, for an error path that has run out of patience.
 */
export async function reportUnknownOutcome(
  page: Page,
  expected: readonly string[],
): Promise<never> {
  const observed = await readRoute(page);
  throw new PlatformError(
    PlatformErrorCode.NAVIGATION_FAILED,
    `None of ${expected.join(", ")} happened within the allotted time, so the outcome is unknown. The browser is on "${
      observed ?? page.url()
    }".`,
    { severity: "critical", context: { expected, observed: observed ?? page.url() } },
  );
}
