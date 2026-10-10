import { PlatformError, PlatformErrorCode } from "../../platform/errors/index.js";

/**
 * Reading and writing money the way the shop displays it.
 *
 * Currency formatting is a presentation concern, so it stays out of the domain: the
 * domain reasons in integer minor units and only this module touches rendered strings.
 * Parsing is strict and fails loudly, because silently coercing "$1 234" into a number
 * would turn a UI change into a wrong assertion.
 */

/**
 * Grouping is only valid as three-digit separators, so `"$1,23"` and `"$12,34,567"` are
 * refused rather than quietly read as amounts. A rejected string is a platform failure the
 * run reports; a misread one is an assertion that passes for the wrong reason.
 */
const MONEY_PATTERN = /^\$-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?$/;

export function parseMoneyToCents(displayed: string): number {
  const trimmed = displayed.trim();

  if (!MONEY_PATTERN.test(trimmed)) {
    throw new PlatformError(
      PlatformErrorCode.EXTRACTION_FAILED,
      `Expected a US dollar amount such as "$1,234.56" but read "${displayed}".`,
      { context: { displayed } },
    );
  }

  const numeric = Number(trimmed.replace("$", "").replace(/,/g, ""));
  return Math.round(numeric * 100);
}

/**
 * The shop renders free shipping as a word rather than an amount, so "Free" is a valid
 * reading of zero and nothing else.
 */
export function parseShippingToCents(displayed: string): number {
  const trimmed = displayed.trim();
  if (trimmed.toLowerCase() === "free") {
    return 0;
  }
  return parseMoneyToCents(trimmed);
}

export function parseCount(displayed: string): number {
  const trimmed = displayed.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new PlatformError(
      PlatformErrorCode.EXTRACTION_FAILED,
      `Expected an integer count but read "${displayed}".`,
      { context: { displayed } },
    );
  }
  return Number.parseInt(trimmed, 10);
}

/** Used in assertion messages and logs; never for comparison, which is done in cents. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
