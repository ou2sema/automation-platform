/**
 * Order placement rules.
 *
 * Kept separate from pricing because they gate *whether* an action may happen, while
 * pricing decides *what it costs*. Both are browser-free, so a rule can be tested and
 * reasoned about without any page open.
 */

export const ORDER_REFERENCE_PATTERN = /^ORD-\d{4}$/;

export const POSTAL_CODE_PATTERN = /^\d{5}$/;

export type CheckoutBlocker = "unauthenticated" | "empty-cart" | "invalid-postal-code";

export function isOrderReference(value: string): boolean {
  return ORDER_REFERENCE_PATTERN.test(value);
}

export function isPostalCode(value: string): boolean {
  return POSTAL_CODE_PATTERN.test(value);
}

/**
 * Decide whether an order may be placed, before touching the application.
 *
 * Returning a value rather than throwing lets the caller choose how to report it, and
 * keeps the domain free of any error taxonomy. The block exists so an invalid request
 * never reaches a non-idempotent action.
 */
export function findCheckoutBlocker(input: {
  readonly authenticated: boolean;
  readonly lineCount: number;
  readonly postalCode: string;
}): CheckoutBlocker | null {
  if (!input.authenticated) {
    return "unauthenticated";
  }
  if (input.lineCount === 0) {
    return "empty-cart";
  }
  if (!isPostalCode(input.postalCode)) {
    return "invalid-postal-code";
  }
  return null;
}

const BLOCKER_MESSAGES: Record<CheckoutBlocker, string> = {
  unauthenticated: "An order requires an authenticated session.",
  "empty-cart": "An order cannot be placed from an empty cart.",
  "invalid-postal-code": "An order requires a five-digit postal code.",
};

export function describeBlocker(blocker: CheckoutBlocker): string {
  return BLOCKER_MESSAGES[blocker];
}
