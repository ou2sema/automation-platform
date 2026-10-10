import type { ExecutionContext } from "../../platform/contracts.js";
import { CartService, type CartSnapshot } from "../../applications/shop/index.js";
import { withinJobSpan } from "../jobSpan.js";

/**
 * A cart change, expressed as the two things a customer can actually do to a line.
 *
 * A discriminated union rather than `{ action, quantity? }`, so an impossible combination
 * such as "remove with no quantity" cannot be constructed, and `exactOptionalPropertyTypes`
 * never has to guess whether an absent quantity means zero or unset.
 */
export type CartUpdate =
  | { readonly action: "remove"; readonly displayName: string }
  | { readonly action: "set-quantity"; readonly displayName: string; readonly quantity: number };

/**
 * Use case: change the cart, then report the cart that results.
 *
 * Returning the new snapshot instead of a boolean is what lets a scenario assert that a
 * removal really recalculated the totals rather than merely removing a row.
 */
export class UpdateCartJob {
  private readonly context: ExecutionContext;
  private readonly cartService: CartService;

  constructor(context: ExecutionContext) {
    this.context = context;
    this.cartService = new CartService(context);
  }

  run(update: CartUpdate): Promise<CartSnapshot> {
    return withinJobSpan(this.context, async () => {
      if (update.action === "remove") {
        return this.cartService.remove(update.displayName);
      }
      return this.cartService.setQuantity(update.displayName, update.quantity);
    });
  }
}
