import type { ExecutionContext } from "../../platform/contracts.js";
import {
  CheckoutService,
  type CheckoutArrival,
  type PlaceOrderOutcome,
} from "../../applications/shop/index.js";
import { withinJobSpan } from "../jobSpan.js";

/**
 * Use case: reach checkout, and place the order from there.
 *
 * `open()` reports a redirect instead of failing, because "the cart will not let you
 * checkout while it is empty" is a business outcome the scenario asserts on. `placeOrder()`
 * is the only path that mutates the application irreversibly, so it is separated here and
 * its exactly-once property is asserted by the flow rather than assumed.
 */
export class CheckoutJob {
  private readonly context: ExecutionContext;
  private readonly checkoutService: CheckoutService;

  constructor(context: ExecutionContext) {
    this.context = context;
    this.checkoutService = new CheckoutService(context);
  }

  open(): Promise<CheckoutArrival> {
    return withinJobSpan(this.context, () => this.checkoutService.openCheckout());
  }

  placeOrder(input: {
    readonly postalCode: string;
    readonly deliveryNote: string;
  }): Promise<PlaceOrderOutcome> {
    return withinJobSpan(this.context, () => this.checkoutService.placeOrder(input));
  }
}
