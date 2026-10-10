import type { CartLine, CartTotals } from "./types.js";

/**
 * Commercial rules for the shop, stated once, on the test side.
 *
 * The fixture application declares equivalent constants of its own. That duplication
 * is intentional: the two implementations are independent, so the flow compares them
 * instead of trusting either. A pricing change in the application shows up as a failed
 * scenario rather than a green run whose oracle was edited to match the bug.
 */
export const PRICING_RULES = {
  currency: "USD",
  standardShippingCents: 499,
  freeShippingFromCents: 7500,
  taxRatePercent: 8,
  minQuantity: 1,
  maxQuantity: 99,
} as const;

function sumSubtotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

export function lineTotalCents(line: CartLine): number {
  return line.unitPriceCents * line.quantity;
}

export function subtotalCents(lines: readonly CartLine[]): number {
  return sumSubtotal(lines);
}

export function shippingCentsFor(subtotal: number): number {
  if (subtotal <= 0) {
    return 0;
  }
  return subtotal >= PRICING_RULES.freeShippingFromCents ? 0 : PRICING_RULES.standardShippingCents;
}

/**
 * Multiply before dividing, so the intermediate value stays an exact integer. At this rate
 * no subtotal lands exactly on a half cent, so `Math.round` has one possible answer;
 * keeping the arithmetic integral is what makes that remain true if the rate changes.
 */
export function taxCentsFor(subtotal: number): number {
  if (subtotal <= 0) {
    return 0;
  }
  return Math.round((subtotal * PRICING_RULES.taxRatePercent) / 100);
}

export function calculateTotals(lines: readonly CartLine[]): CartTotals {
  const subtotal = sumSubtotal(lines);
  const shipping = shippingCentsFor(subtotal);
  const tax = taxCentsFor(subtotal);

  return {
    subtotalCents: subtotal,
    shippingCents: shipping,
    taxCents: tax,
    totalCents: subtotal + shipping + tax,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

/**
 * Money is compared in minor units. Reading a rendered string and re-formatting it is a
 * presentation concern; deciding whether two amounts are equal is a business one.
 */
export interface TotalsMismatch {
  readonly field: keyof CartTotals;
  readonly expectedCents: number;
  readonly observedCents: number;
}

export function diffTotals(expected: CartTotals, observed: CartTotals): TotalsMismatch[] {
  const fields: (keyof CartTotals)[] = [
    "subtotalCents",
    "shippingCents",
    "taxCents",
    "totalCents",
    "itemCount",
  ];

  return fields
    .filter((field) => expected[field] !== observed[field])
    .map((field) => ({
      field,
      expectedCents: expected[field],
      observedCents: observed[field],
    }));
}

export function isAllowedQuantity(quantity: number): boolean {
  return (
    Number.isInteger(quantity) &&
    quantity >= PRICING_RULES.minQuantity &&
    quantity <= PRICING_RULES.maxQuantity
  );
}
