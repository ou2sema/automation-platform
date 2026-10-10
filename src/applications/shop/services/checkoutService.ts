import type { ExecutionContext } from "../../../platform/contracts.js";
import {
  BusinessRuleError,
  PlatformError,
  PlatformErrorCode,
} from "../../../platform/errors/index.js";
import { describeBlocker, findCheckoutBlocker } from "../../../domains/shop/index.js";
import { shopPageUrl } from "../configuration.js";
import { CheckoutPage, OrderConfirmationPage, type OrderConfirmation } from "../pages/index.js";
import { firstFulfilled, readRoute, reportUnknownOutcome, waitForRoute } from "../navigation.js";
import type { CheckoutArrival } from "./types.js";

export type PlaceOrderOutcome =
  | {
      readonly status: "placed";
      readonly confirmation: OrderConfirmation;
      readonly amountDueBeforeSubmitCents: number;
    }
  | { readonly status: "rejected"; readonly message: string };

/**
 * Checkout and order placement.
 *
 * The eligibility rules are evaluated from the domain *before* the submit button is
 * pressed, so an order that cannot legally exist never reaches the application. The amount
 * due is captured before submission and compared with the confirmation afterwards, which
 * is what makes "the charge changed at the last moment" a detectable failure.
 */
export class CheckoutService {
  private readonly context: ExecutionContext;

  constructor(context: ExecutionContext) {
    this.context = context;
  }

  async openCheckout(): Promise<CheckoutArrival> {
    const page = await this.context.page();
    const timeout = this.timeout();
    const checkout = new CheckoutPage(page, timeout);
    await checkout.open(shopPageUrl(this.context.config, "checkout"));

    // The shop answers with one of three pages, and each is a determinate outcome worth
    // detecting rather than timing out on.
    const landedOn = await firstFulfilled(
      [
        { value: "checkout" as const, promise: waitForRoute(page, "checkout", timeout) },
        { value: "cart" as const, promise: waitForRoute(page, "cart", timeout) },
        { value: "sign-in" as const, promise: waitForRoute(page, "sign-in", timeout) },
      ],
      timeout,
    );

    if (landedOn === "checkout") {
      return { status: "checkout" };
    }
    if (landedOn === "cart") {
      return { status: "redirected", reason: "empty-cart" };
    }
    if (landedOn === "sign-in") {
      return { status: "redirected", reason: "unauthenticated" };
    }

    return reportUnknownOutcome(page, ["the checkout page", "the cart page", "the sign-in page"]);
  }

  async placeOrder(input: {
    readonly postalCode: string;
    readonly deliveryNote: string;
  }): Promise<PlaceOrderOutcome> {
    const page = await this.context.page();
    const timeout = this.timeout();
    const checkout = new CheckoutPage(page, timeout);

    if ((await readRoute(page)) !== "checkout") {
      await checkout.open(shopPageUrl(this.context.config, "checkout"));
      if ((await readRoute(page)) !== "checkout") {
        throw new PlatformError(
          PlatformErrorCode.NAVIGATION_FAILED,
          "Checkout was requested but the shop will not show the checkout page.",
          { context: { observedRoute: await readRoute(page) } },
        );
      }
    }

    const lineCount = await checkout.lineCount();
    const blocker = findCheckoutBlocker({
      authenticated: true,
      lineCount,
      postalCode: input.postalCode,
    });

    if (blocker !== null) {
      throw new BusinessRuleError(describeBlocker(blocker), {
        context: { blocker, lineCount },
      });
    }

    const amountDueBeforeSubmitCents = await checkout.displayedTotalCents();

    // Only the shape of the request is logged. The delivery note is form data and is never
    // written to a log, a report or an event payload.
    this.context.logger.info("Order submitted.", {
      amountDueCents: amountDueBeforeSubmitCents,
      lineCount,
    });

    await checkout.submit({ postalCode: input.postalCode, deliveryNote: input.deliveryNote });

    const signal = await firstFulfilled(
      [
        {
          value: "placed" as const,
          promise: waitForRoute(page, "order-confirmation", timeout),
        },
        { value: "rejected" as const, promise: checkout.rejectionSignal(timeout) },
      ],
      timeout,
    );

    if (signal === "placed") {
      const confirmation = await new OrderConfirmationPage(page, timeout).read();
      this.context.logger.info("Order confirmed.", {
        reference: confirmation.reference,
        totalCents: confirmation.totalCents,
        ordersInSession: confirmation.ordersInSession,
      });
      return { status: "placed", confirmation, amountDueBeforeSubmitCents };
    }

    if (signal === "rejected") {
      const message = await checkout.rejectionMessage();
      if (message === null) {
        return reportUnknownOutcome(page, ["a readable rejection message"]);
      }
      return { status: "rejected", message };
    }

    return reportUnknownOutcome(page, [
      "the order confirmation page",
      "a rejection from the checkout page",
    ]);
  }

  private timeout(): number {
    return this.context.config.browser.timeouts.navigationMs;
  }
}
