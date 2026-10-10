import { describe, expect, it } from "vitest";

import {
  calculateTotals,
  diffTotals,
  EMPTY_TOTALS,
  isAllowedQuantity,
  lineTotalCents,
  PRICING_RULES,
  shippingCentsFor,
  subtotalCents,
  taxCentsFor,
  type CartLine,
} from "../../src/domains/shop/index.js";

/**
 * The domain oracle, tested on its own.
 *
 * These expectations are hand-computed from the commercial rules, not produced by
 * calling the functions under test. The fixture application keeps its own independent
 * copy of the same rules; this file deliberately does not read them, because an oracle
 * imported from the thing it grades is not an oracle.
 */

const KEYBOARD: CartLine = {
  sku: "kb-01",
  displayName: "Mechanical Keyboard",
  unitPriceCents: 4900,
  quantity: 1,
};

const CABLE: CartLine = {
  sku: "cb-04",
  displayName: "Braided USB-C Cable",
  unitPriceCents: 999,
  quantity: 1,
};

function withQuantity(line: CartLine, quantity: number): CartLine {
  return { ...line, quantity };
}

describe("pricing rules", () => {
  it("states the rules the fixture is expected to disagree with loudly", () => {
    expect(PRICING_RULES).toMatchObject({
      currency: "USD",
      standardShippingCents: 499,
      freeShippingFromCents: 7500,
      taxRatePercent: 8,
    });
  });
});

describe("subtotal and line totals", () => {
  it("treats an empty cart as no money rather than an error", () => {
    expect(subtotalCents([])).toBe(0);
    expect(calculateTotals([])).toEqual(EMPTY_TOTALS);
  });

  it("multiplies unit price by quantity per line", () => {
    expect(lineTotalCents(withQuantity(CABLE, 3))).toBe(2997);
    expect(subtotalCents([withQuantity(KEYBOARD, 2), withQuantity(CABLE, 3)])).toBe(12797);
  });
});

describe("shipping", () => {
  it("charges nothing for an empty cart", () => {
    expect(shippingCentsFor(0)).toBe(0);
  });

  it("charges standard shipping below the threshold", () => {
    expect(shippingCentsFor(1)).toBe(499);
    expect(shippingCentsFor(7499)).toBe(499);
  });

  /** `>=` versus `>` at this exact subtotal is a one-line bug worth its own test. */
  it("waives shipping at the threshold and above", () => {
    expect(shippingCentsFor(7500)).toBe(0);
    expect(shippingCentsFor(7501)).toBe(0);
  });
});

describe("tax", () => {
  it("charges no tax on an empty cart", () => {
    expect(taxCentsFor(0)).toBe(0);
  });

  it.each([
    [999, 80],
    [4900, 392],
    [7500, 600],
    [12797, 1024],
    [1, 0],
  ] as const)("rounds %i cents of subtotal to %i cents of tax", (subtotal, expected) => {
    expect(taxCentsFor(subtotal)).toBe(expected);
  });
});

describe("calculateTotals", () => {
  it("sums the parts it reports", () => {
    const totals = calculateTotals([withQuantity(KEYBOARD, 2), withQuantity(CABLE, 3)]);

    expect(totals).toEqual({
      subtotalCents: 12797,
      shippingCents: 0,
      taxCents: 1024,
      totalCents: 13821,
      itemCount: 5,
    });
  });

  /** The small-order path: shipping is part of what is charged, not an afterthought. */
  it("adds shipping to a small order", () => {
    const totals = calculateTotals([withQuantity(CABLE, 1)]);

    expect(totals).toEqual({
      subtotalCents: 999,
      shippingCents: 499,
      taxCents: 80,
      totalCents: 1578,
      itemCount: 1,
    });
  });

  it("counts units rather than lines", () => {
    const totals = calculateTotals([withQuantity(KEYBOARD, 3), withQuantity(KEYBOARD, 4)]);

    expect(totals.itemCount).toBe(7);
    expect(totals.subtotalCents).toBe(34300);
  });
});

describe("diffTotals", () => {
  it("reports nothing when the displayed money matches the rules", () => {
    const lines = [withQuantity(KEYBOARD, 2), withQuantity(CABLE, 3)];

    expect(diffTotals(calculateTotals(lines), calculateTotals(lines))).toEqual([]);
  });

  it("names the field and both values when it does not", () => {
    const expected = calculateTotals([withQuantity(CABLE, 1)]);

    expect(diffTotals(expected, { ...expected, shippingCents: 0 })).toEqual([
      { field: "shippingCents", expectedCents: 499, observedCents: 0 },
    ]);
  });

  it("reports every field that disagrees, not just the first", () => {
    const expected = calculateTotals([withQuantity(CABLE, 1)]);
    const observed = { ...expected, taxCents: 79, totalCents: 1577 };

    const mismatches = diffTotals(expected, observed);

    expect(mismatches.map((mismatch) => mismatch.field)).toEqual(["taxCents", "totalCents"]);
  });
});

describe("isAllowedQuantity", () => {
  it("accepts both ends of the published range", () => {
    expect(isAllowedQuantity(PRICING_RULES.minQuantity)).toBe(true);
    expect(isAllowedQuantity(PRICING_RULES.maxQuantity)).toBe(true);
  });

  it("rejects outside the range", () => {
    expect(isAllowedQuantity(0)).toBe(false);
    expect(isAllowedQuantity(-1)).toBe(false);
    expect(isAllowedQuantity(100)).toBe(false);
  });

  /**
   * A fractional quantity would be typed into a field the application clamps, so the
   * test would silently exercise a different order than the one it asked for.
   */
  it("rejects values that are not whole numbers", () => {
    expect(isAllowedQuantity(1.5)).toBe(false);
    expect(isAllowedQuantity(Number.NaN)).toBe(false);
    expect(isAllowedQuantity(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
