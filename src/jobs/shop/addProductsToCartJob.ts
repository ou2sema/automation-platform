import type { ExecutionContext } from "../../platform/contracts.js";
import { CartService, type AddRequest, type CartSnapshot } from "../../applications/shop/index.js";
import { withinJobSpan } from "../jobSpan.js";

/**
 * Use case: put a set of products into the cart and report what the cart then shows.
 *
 * The returned snapshot is the raw reading from the page. Comparison against the pricing
 * rules is a separate step, so an arithmetic failure is reported as a mismatch between two
 * independent figures rather than as a navigation error.
 */
export class AddProductsToCartJob {
  private readonly context: ExecutionContext;
  private readonly cartService: CartService;

  constructor(context: ExecutionContext) {
    this.context = context;
    this.cartService = new CartService(context);
  }

  run(input: { readonly items: readonly AddRequest[] }): Promise<CartSnapshot> {
    return withinJobSpan(this.context, async () => {
      await this.cartService.openCatalogue();
      return this.cartService.addProducts(input.items);
    });
  }
}
