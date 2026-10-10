import { describe, expect, it } from "vitest";

import { isPlatformError, PlatformErrorCode } from "../../src/index.js";
import {
  formatCents,
  parseCount,
  parseMoneyToCents,
  parseShippingToCents,
} from "../../src/applications/shop/display.js";

/**
 * Reading rendered money.
 *
 * Every refusal here is deliberate: an amount the runner cannot read must fail the run,
 * because a coerced amount becomes an assertion that agrees with whatever the page said.
 */

function expectExtraction(read: () => unknown): void {
  const failure = (() => {
    try {
      read();
      return undefined;
    } catch (cause) {
      return cause;
    }
  })();

  expect(isPlatformError(failure) && failure.code).toBe(PlatformErrorCode.EXTRACTION_FAILED);
}

describe("parseMoneyToCents", () => {
  it("reads amounts as integer minor units", () => {
    expect(parseMoneyToCents("$0.00")).toBe(0);
    expect(parseMoneyToCents("$4.99")).toBe(499);
    expect(parseMoneyToCents("$999.00")).toBe(99_900);
    expect(parseMoneyToCents("$1,234.56")).toBe(123_456);
    expect(parseMoneyToCents("$12,345,678.90")).toBe(1_234_567_890);
  });

  it("tolerates the whitespace a rendered page leaves behind", () => {
    expect(parseMoneyToCents("  $999.00 \n")).toBe(99_900);
  });

  it("treats a whole-dollar amount as cents rather than dollars", () => {
    expect(parseMoneyToCents("$499")).toBe(49_900);
  });

  it("refuses malformed grouping instead of guessing at it", () => {
    for (const displayed of ["$1,23", "$12,34,567", "$1,2345"]) {
      expectExtraction(() => parseMoneyToCents(displayed));
    }
  });

  it("refuses anything that is not a US dollar amount", () => {
    for (const displayed of ["", "Free", "USD 5.00", "5", "$1234.5", "$1234.567", "-$5.00"]) {
      expectExtraction(() => parseMoneyToCents(displayed));
    }
  });

  it("quotes what it actually read", () => {
    expect(() => parseMoneyToCents("SEK 99")).toThrow(/SEK 99/);
  });
});

describe("parseShippingToCents", () => {
  it("reads the word the application uses for zero", () => {
    expect(parseShippingToCents("Free")).toBe(0);
    expect(parseShippingToCents("free")).toBe(0);
    expect(parseShippingToCents("  FREE  ")).toBe(0);
  });

  it("reads a charged amount like any other money", () => {
    expect(parseShippingToCents("$4.99")).toBe(499);
  });

  it("refuses a discount that is neither a word nor an amount", () => {
    expectExtraction(() => parseShippingToCents("0"));
    expectExtraction(() => parseShippingToCents("no charge"));
  });
});

describe("parseCount", () => {
  it("reads a displayed count", () => {
    expect(parseCount("0")).toBe(0);
    expect(parseCount("7")).toBe(7);
    expect(parseCount(" 12 ")).toBe(12);
  });

  it("refuses a count wrapped in surrounding text", () => {
    for (const displayed of ["7 items", "-1", "1.5", "", "three"]) {
      expectExtraction(() => parseCount(displayed));
    }
  });
});

describe("formatCents", () => {
  it("is for messages, and round-trips what the parser accepts", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(499)).toBe("$4.99");
    expect(formatCents(13_821)).toBe("$138.21");
    expect(parseMoneyToCents(formatCents(123_456))).toBe(123_456);
  });
});
