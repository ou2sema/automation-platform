import { Given, Then, When } from "@cucumber/cucumber";

import type {
  CartSnapshot,
  CheckoutArrival,
  PlaceOrderOutcome,
} from "../../applications/shop/index.js";
import type { ShopSession } from "../../domains/shop/index.js";
import {
  PRICING_RULES,
  calculateTotals,
  diffTotals,
  isOrderReference,
} from "../../domains/shop/index.js";
import {
  AddProductsToCartJob,
  CheckoutJob,
  ReadCartJob,
  SignInJob,
  UpdateCartJob,
} from "../../jobs/shop/index.js";
import { AssertionFailedError } from "../../platform/errors/index.js";
import type { PlatformWorld } from "../../platform/cucumber/world.js";
import { createShopTestData } from "../../support/shopTestData.js";

/**
 * Purchase flow steps.
 *
 * Each step either drives one Job or asserts on a Job result. There is no locator, no
 * page object and no browser call here, which is the boundary the platform exists to keep:
 * Gherkin states business intent, and everything below it is reusable by a runner that has
 * no Cucumber in the picture at all.
 */
const SESSION_KEY = "shop.session";
const CART_KEY = "shop.cart";
const ARRIVAL_KEY = "shop.checkoutArrival";
const ORDER_KEY = "shop.order";

Given<PlatformWorld>("the customer is signed in to the shop", async function () {
  const data = createShopTestData(this.correlation);
  const outcome = await new SignInJob(this).run({
    username: data.accountName,
    password: data.password,
  });

  if (outcome.status !== "authenticated") {
    // A background that cannot establish its precondition must fail, not continue and
    // hope the next step notices.
    throw new AssertionFailedError(
      `The scenario could not reach a signed-in state: ${outcome.message}`,
      { context: { account: data.accountName, status: outcome.status } },
    );
  }

  this.remember<ShopSession>(SESSION_KEY, outcome.session);
});

When<PlatformWorld>(
  "the customer adds {int} of {string} to the cart",
  async function (quantity: number, product: string) {
    const snapshot = await new AddProductsToCartJob(this).run({
      items: [{ displayName: product, quantity }],
    });
    this.remember<CartSnapshot>(CART_KEY, snapshot);
  },
);

When<PlatformWorld>("the customer opens the cart", async function () {
  const snapshot = await new ReadCartJob(this).run();
  this.remember<CartSnapshot>(CART_KEY, snapshot);
});

When<PlatformWorld>(
  "the customer sets the quantity of {string} to {int}",
  async function (product: string, quantity: number) {
    const snapshot = await new UpdateCartJob(this).run({
      action: "set-quantity",
      displayName: product,
      quantity,
    });
    this.remember<CartSnapshot>(CART_KEY, snapshot);
  },
);

When<PlatformWorld>(
  "the customer removes {string} from the cart",
  async function (product: string) {
    const snapshot = await new UpdateCartJob(this).run({
      action: "remove",
      displayName: product,
    });
    this.remember<CartSnapshot>(CART_KEY, snapshot);
  },
);

Then<PlatformWorld>("the cart is empty", function () {
  const snapshot = this.recall<CartSnapshot>(CART_KEY);
  if (!snapshot.isEmpty || snapshot.lines.length !== 0) {
    throw new AssertionFailedError(
      `Expected an empty cart but it holds ${String(snapshot.lines.length)} line(s).`,
      { context: { lines: snapshot.lines.length, isEmpty: snapshot.isEmpty } },
    );
  }
});

Then<PlatformWorld>("the cart holds {int} units in total", function (expected: number) {
  const snapshot = this.recall<CartSnapshot>(CART_KEY);
  if (snapshot.displayed.itemCount !== expected) {
    throw new AssertionFailedError(
      `Expected ${String(expected)} units in the cart but the page shows ${String(snapshot.displayed.itemCount)}.`,
      {
        context: {
          expected,
          observed: snapshot.displayed.itemCount,
          lines: snapshot.lines.map((line) => `${line.sku}x${String(line.quantity)}`),
        },
      },
    );
  }
});

/**
 * The comparison that makes this flow meaningful: the money the application rendered
 * against the money the platform's own pricing rules produce from the same lines.
 */
Then<PlatformWorld>("the cart totals agree with the pricing rules", function () {
  const snapshot = this.recall<CartSnapshot>(CART_KEY);
  const expected = calculateTotals(snapshot.lines);
  const mismatches = diffTotals(expected, snapshot.displayed);

  if (mismatches.length > 0) {
    throw new AssertionFailedError(
      `The shop's totals differ from the pricing rules for ${mismatches
        .map(
          (mismatch) =>
            `${String(mismatch.field)} (expected ${String(mismatch.expectedCents)}, observed ${String(mismatch.observedCents)})`,
        )
        .join("; ")}.`,
      { context: { mismatches, lines: snapshot.lines.length } },
    );
  }
});

Then<PlatformWorld>("the order is below the free shipping threshold", function () {
  const snapshot = this.recall<CartSnapshot>(CART_KEY);
  const { subtotalCents, shippingCents } = snapshot.displayed;

  if (subtotalCents >= PRICING_RULES.freeShippingFromCents) {
    throw new AssertionFailedError(
      `Expected a subtotal below ${String(PRICING_RULES.freeShippingFromCents)} but it is ${String(subtotalCents)}.`,
      { context: { subtotalCents, shippingCents } },
    );
  }

  if (shippingCents !== PRICING_RULES.standardShippingCents) {
    throw new AssertionFailedError(
      `A small order should be charged ${String(PRICING_RULES.standardShippingCents)} in shipping but shows ${String(shippingCents)}.`,
      { context: { subtotalCents, shippingCents } },
    );
  }
});

When<PlatformWorld>("the customer proceeds to checkout", async function () {
  const arrival = await new CheckoutJob(this).open();
  this.remember<CheckoutArrival>(ARRIVAL_KEY, arrival);
});

Then<PlatformWorld>("checkout is refused because the cart is empty", function () {
  const arrival = this.recall<CheckoutArrival>(ARRIVAL_KEY);
  if (arrival.status !== "redirected" || arrival.reason !== "empty-cart") {
    throw new AssertionFailedError(
      `Expected checkout to be refused for an empty cart but the flow reports "${arrival.status}".`,
      { context: { arrival } },
    );
  }
});

When<PlatformWorld>("the customer places the order", async function () {
  const data = createShopTestData(this.correlation);
  const outcome = await new CheckoutJob(this).placeOrder({
    postalCode: data.postalCode,
    deliveryNote: data.deliveryNote,
  });
  this.remember<PlaceOrderOutcome>(ORDER_KEY, outcome);
});

Then<PlatformWorld>("the order is confirmed with exactly one order", function () {
  const outcome = this.recall<PlaceOrderOutcome>(ORDER_KEY);

  if (outcome.status !== "placed") {
    throw new AssertionFailedError(
      `The order was not placed: the shop reported "${outcome.message}".`,
      { context: { status: outcome.status } },
    );
  }

  const { confirmation } = outcome;

  if (!isOrderReference(confirmation.reference)) {
    throw new AssertionFailedError(
      `"${confirmation.reference}" is not a well-formed order reference.`,
      { context: { reference: confirmation.reference } },
    );
  }

  // The non-idempotent action must have happened once. Two orders would mean the submit
  // was replayed, which no amount of retrying is allowed to produce.
  if (confirmation.ordersInSession !== 1) {
    throw new AssertionFailedError(
      `Expected exactly one order in this session but ${String(confirmation.ordersInSession)} exist.`,
      { context: { ordersInSession: confirmation.ordersInSession } },
    );
  }
});

Then<PlatformWorld>("the amount paid matches the pricing rules", function () {
  const outcome = this.recall<PlaceOrderOutcome>(ORDER_KEY);
  const snapshot = this.recall<CartSnapshot>(CART_KEY);

  if (outcome.status !== "placed") {
    throw new AssertionFailedError("No order was placed, so there is no amount to check.", {
      context: { status: outcome.status },
    });
  }

  const expected = calculateTotals(snapshot.lines).totalCents;
  const { confirmation, amountDueBeforeSubmitCents } = outcome;

  if (confirmation.totalCents !== expected) {
    throw new AssertionFailedError(
      `The order charged ${String(confirmation.totalCents)} but the pricing rules give ${String(expected)}.`,
      { context: { charged: confirmation.totalCents, expected } },
    );
  }

  if (amountDueBeforeSubmitCents !== confirmation.totalCents) {
    throw new AssertionFailedError(
      `The amount due changed during submission: ${String(amountDueBeforeSubmitCents)} was shown, ${String(confirmation.totalCents)} was charged.`,
      { context: { shown: amountDueBeforeSubmitCents, charged: confirmation.totalCents } },
    );
  }

  if (confirmation.itemCount !== snapshot.displayed.itemCount) {
    throw new AssertionFailedError(
      `The order contains ${String(confirmation.itemCount)} units but the cart held ${String(snapshot.displayed.itemCount)}.`,
      {
        context: {
          ordered: confirmation.itemCount,
          cart: snapshot.displayed.itemCount,
        },
      },
    );
  }
});
