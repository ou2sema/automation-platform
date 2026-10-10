import type { ExecutionContext } from "../../platform/contracts.js";
import { CartService, type CartSnapshot } from "../../applications/shop/index.js";
import { withinJobSpan } from "../jobSpan.js";

/**
 * Use case: read the cart as the application currently displays it.
 *
 * Read-only by design. A step that wants to check a total must not be able to change the
 * cart while doing it.
 */
export class ReadCartJob {
  private readonly context: ExecutionContext;
  private readonly cartService: CartService;

  constructor(context: ExecutionContext) {
    this.context = context;
    this.cartService = new CartService(context);
  }

  run(): Promise<CartSnapshot> {
    return withinJobSpan(this.context, () => this.cartService.openCart());
  }
}
