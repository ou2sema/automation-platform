/**
 * Domain vocabulary for the shop.
 *
 * These types describe business facts, not UI state. Anything that only makes sense
 * because a browser renders it (currency strings, element text, routes) lives in the
 * application layer instead, so the rules below can be reasoned about and tested
 * without a browser running.
 */

export interface CartLine {
  readonly sku: string;
  readonly displayName: string;
  readonly unitPriceCents: number;
  readonly quantity: number;
}

export interface CartTotals {
  readonly subtotalCents: number;
  readonly shippingCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly itemCount: number;
}

/**
 * An authenticated identity. Deliberately contains no credential: nothing downstream
 * is allowed to receive a password, so no layer can accidentally log or persist one.
 */
export interface ShopSession {
  readonly username: string;
  readonly displayName: string;
}

export interface PlacedOrder {
  readonly reference: string;
  readonly totals: CartTotals;
}

export const EMPTY_TOTALS: CartTotals = {
  subtotalCents: 0,
  shippingCents: 0,
  taxCents: 0,
  totalCents: 0,
  itemCount: 0,
};
