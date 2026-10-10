import { describe, expect, it } from "vitest";

import {
  describeBlocker,
  findCheckoutBlocker,
  isOrderReference,
  isPostalCode,
  type CheckoutBlocker,
} from "../../src/domains/shop/index.js";

/**
 * Order placement rules, tested without a browser.
 *
 * `findCheckoutBlocker` exists to stop an illegal request reaching a non-idempotent
 * action, so its precedence and its "nothing is wrong" answer matter more than its
 * wording.
 */

const VALID: {
  readonly authenticated: boolean;
  readonly lineCount: number;
  readonly postalCode: string;
} = { authenticated: true, lineCount: 2, postalCode: "12345" };

describe("isOrderReference", () => {
  it("accepts the shape the application issues", () => {
    expect(isOrderReference("ORD-0001")).toBe(true);
    expect(isOrderReference("ORD-9999")).toBe(true);
  });

  it("rejects anything that only looks close", () => {
    expect(isOrderReference("ORD-1")).toBe(false);
    expect(isOrderReference("ORD-00001")).toBe(false);
    expect(isOrderReference("ord-0001")).toBe(false);
    expect(isOrderReference("ORD-000A")).toBe(false);
    expect(isOrderReference("")).toBe(false);
    expect(isOrderReference("ORD-0001 ")).toBe(false);
  });
});

describe("isPostalCode", () => {
  it("accepts exactly five digits", () => {
    expect(isPostalCode("12345")).toBe(true);
    expect(isPostalCode("00000")).toBe(true);
  });

  it("rejects short, long, non-numeric and padded values", () => {
    expect(isPostalCode("1234")).toBe(false);
    expect(isPostalCode("123456")).toBe(false);
    expect(isPostalCode("12 45")).toBe(false);
    expect(isPostalCode("1234a")).toBe(false);
    expect(isPostalCode(" 12345")).toBe(false);
  });
});

describe("findCheckoutBlocker", () => {
  it("returns null only when every rule is satisfied", () => {
    expect(findCheckoutBlocker(VALID)).toBeNull();
  });

  it.each<[CheckoutBlocker, typeof VALID]>([
    ["unauthenticated", { ...VALID, authenticated: false }],
    ["empty-cart", { ...VALID, lineCount: 0 }],
    ["invalid-postal-code", { ...VALID, postalCode: "SW1" }],
  ])("names %s for the request that triggers it", (expected, input) => {
    expect(findCheckoutBlocker(input)).toBe(expected);
  });

  /**
   * The order of checks is a safety property: a visitor with no session and no goods
   * must not be told their postcode is wrong, and an unauthenticated request is refused
   * before anything else is examined.
   */
  it("reports the most fundamental problem first", () => {
    expect(findCheckoutBlocker({ authenticated: false, lineCount: 0, postalCode: "nope" })).toBe(
      "unauthenticated",
    );
    expect(findCheckoutBlocker({ ...VALID, lineCount: 0, postalCode: "nope" })).toBe("empty-cart");
  });
});

describe("describeBlocker", () => {
  it("explains each blocker without exposing form values", () => {
    const messages: readonly (readonly [CheckoutBlocker, string])[] = [
      ["unauthenticated", "An order requires an authenticated session."],
      ["empty-cart", "An order cannot be placed from an empty cart."],
      ["invalid-postal-code", "An order requires a five-digit postal code."],
    ];

    for (const [blocker, message] of messages) {
      expect(describeBlocker(blocker)).toBe(message);
    }
  });
});
