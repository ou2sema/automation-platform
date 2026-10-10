/**
 * Types shared by the shop services.
 *
 * `CheckoutArrival` exists because two different pages can answer the same question —
 * the cart refuses to advance, or the checkout page redirects a visitor who has no right
 * to be there. One type keeps that answer consistent whichever page produced it, and keeps
 * "redirected" distinct from a genuine failure to interact.
 */
export type CheckoutArrival =
  | { readonly status: "checkout" }
  | { readonly status: "redirected"; readonly reason: "empty-cart" | "unauthenticated" };

export interface AddRequest {
  readonly displayName: string;
  readonly quantity: number;
}
