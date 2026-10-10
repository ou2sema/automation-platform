import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BrowserManager,
  BrowserSession,
  isPlatformError,
  PlatformErrorCode,
  type CorrelationIds,
  type PlatformConfiguration,
} from "../../src/index.js";
import type { ExecutionContext } from "../../src/platform/contracts.js";
import {
  calculateTotals,
  diffTotals,
  isOrderReference,
  type ShopSession,
} from "../../src/domains/shop/index.js";
import { ShopNavigationService } from "../../src/applications/shop/services/navigationService.js";
import {
  SignInService,
  type SignInOutcome,
} from "../../src/applications/shop/services/signInService.js";
import { CartService } from "../../src/applications/shop/services/cartService.js";
import {
  CheckoutService,
  type PlaceOrderOutcome,
} from "../../src/applications/shop/services/checkoutService.js";
import type { OrderConfirmation } from "../../src/applications/shop/pages/index.js";
import {
  createShopTestData,
  REJECTED_PASSWORD,
  type ShopTestData,
} from "../../src/support/shopTestData.js";

import { makeConfiguration } from "../unit/helpers/configuration.js";
import { makeTestLogger, type TestLogger } from "../unit/helpers/logger.js";

/**
 * The shop flow driven by real Chromium, through Services and Page Objects.
 *
 * The Cucumber suite covers the same journey through Jobs and steps; what this file
 * protects is the properties Gherkin is a poor place to assert: that a credential or a
 * form field never reaches the log, that state does not cross browser contexts, and that
 * an ambiguous element is refused rather than guessed at.
 */

interface Scenario {
  readonly session: BrowserSession;
  readonly context: ExecutionContext;
  readonly log: TestLogger;
  readonly data: ShopTestData;
}

function authenticated(outcome: SignInOutcome): ShopSession {
  if (outcome.status !== "authenticated") {
    throw new Error(`Expected an authenticated session, got ${outcome.status}.`);
  }
  return outcome.session;
}

function placed(outcome: PlaceOrderOutcome): OrderConfirmation {
  if (outcome.status !== "placed") {
    throw new Error(`Expected an order to be placed, got ${outcome.status}.`);
  }
  return outcome.confirmation;
}

function loggedText(log: TestLogger): string {
  return log.sink.records
    .map((item) => `${item.message} ${JSON.stringify(item.record)}`)
    .join("\n");
}

describe("shop flow", () => {
  let artifactsRoot = "";
  let config: PlatformConfiguration;
  let manager: BrowserManager;

  beforeAll(async () => {
    artifactsRoot = await mkdtemp(path.join(tmpdir(), "automation-platform-shop-"));
  });

  afterAll(async () => {
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    config = makeConfiguration({
      AP_ARTIFACTS_DIR: artifactsRoot,
      AP_TRACE_MODE: "retain-on-failure",
      AP_VIDEO_MODE: "off",
    });
    manager = new BrowserManager({ config, logger: makeTestLogger().logger });
  });

  afterEach(async () => {
    await manager.close();
  });

  async function openScenario(scenarioId: string): Promise<Scenario> {
    const correlation: CorrelationIds = { runId: "run-integration", scenarioId };
    const log = makeTestLogger({ staticCorrelation: correlation });
    const session = await BrowserSession.create({
      browser: await manager.acquire(),
      config,
      logger: log.logger,
      correlation,
    });

    return {
      session,
      log,
      data: createShopTestData(correlation),
      context: {
        correlation,
        logger: log.logger,
        config,
        page: () => Promise.resolve(session.page),
      },
    };
  }

  async function finish(scenario: Scenario): Promise<void> {
    scenario.session.recordStatus("passed");
    await scenario.session.close();
  }

  async function signIn(scenario: Scenario): Promise<ShopSession> {
    const service = new SignInService(scenario.context);
    return authenticated(
      await service.attempt({
        username: scenario.data.accountName,
        password: scenario.data.password,
      }),
    );
  }

  it("signs in, adds goods, and charges exactly what the pricing rules say", async () => {
    const scenario = await openScenario("purchase");
    await signIn(scenario);

    const cart = new CartService(scenario.context);
    const snapshot = await cart.addProducts([
      { displayName: "Mechanical Keyboard", quantity: 2 },
      { displayName: "Braided USB-C Cable", quantity: 3 },
    ]);

    // The displayed money is graded by the domain's independent calculation.
    expect(diffTotals(calculateTotals(snapshot.lines), snapshot.displayed)).toEqual([]);

    const checkout = new CheckoutService(scenario.context);
    expect(await checkout.openCheckout()).toEqual({ status: "checkout" });

    const confirmation = placed(
      await checkout.placeOrder({
        postalCode: scenario.data.postalCode,
        deliveryNote: scenario.data.deliveryNote,
      }),
    );

    expect(isOrderReference(confirmation.reference)).toBe(true);
    expect(confirmation.totalCents).toBe(calculateTotals(snapshot.lines).totalCents);
    expect(confirmation.itemCount).toBe(5);

    await finish(scenario);
  });

  it("places exactly one order, whatever the confirmation page is asked to do", async () => {
    const scenario = await openScenario("single-order");
    await signIn(scenario);

    const cart = new CartService(scenario.context);
    await cart.addProducts([{ displayName: "Wireless Mouse", quantity: 1 }]);

    const confirmation = placed(
      await new CheckoutService(scenario.context).placeOrder({
        postalCode: scenario.data.postalCode,
        deliveryNote: scenario.data.deliveryNote,
      }),
    );

    expect(confirmation.ordersInSession).toBe(1);

    await finish(scenario);
  });

  it("redirects a signed-out visitor instead of showing a protected page", async () => {
    const scenario = await openScenario("signed-out");
    const navigation = new ShopNavigationService(scenario.context);

    for (const route of ["catalogue", "cart", "checkout"] as const) {
      const landed = await navigation.open(route);
      expect(landed.landedOn, `requested ${route}`).toBe("sign-in");
    }

    await finish(scenario);
  });

  it("refuses to carry a cart into checkout while it is empty", async () => {
    const scenario = await openScenario("empty-cart");
    await signIn(scenario);

    const cart = new CartService(scenario.context);
    expect((await cart.openCart()).isEmpty).toBe(true);
    expect(await cart.proceedToCheckout()).toEqual({ status: "redirected", reason: "empty-cart" });

    await finish(scenario);
  });

  it("refuses to choose between two elements that both match", async () => {
    const scenario = await openScenario("ambiguous");
    await signIn(scenario);

    const page = await scenario.context.page();
    // A duplicated row is what a page change or a broken template produces. Picking the
    // first match would let the run exercise a control nobody meant to test.
    // This callback is serialised into the browser, so it casts for the DOM global it
    // needs instead of importing one the Node type environment does not have.
    await page.evaluate(() => {
      const dom = (
        globalThis as unknown as {
          document: {
            querySelector(selector: string): {
              cloneNode(deep: boolean): unknown;
              parentElement: { append(child: unknown): void } | null;
            } | null;
          };
        }
      ).document;

      const row = dom.querySelector("[data-testid='product']");
      if (row !== null && row.parentElement !== null) {
        row.parentElement.append(row.cloneNode(true));
      }
    });

    const cart = new CartService(scenario.context);
    const failure = await cart
      .addProducts([{ displayName: "Mechanical Keyboard", quantity: 1 }])
      .catch((cause: unknown) => cause);

    expect(isPlatformError(failure) && failure.code).toBe(PlatformErrorCode.ELEMENT_AMBIGUOUS);

    await finish(scenario);
  });

  it("keeps one scenario's session and cart out of another scenario's context", async () => {
    const first = await openScenario("state-holder");
    await signIn(first);
    await new CartService(first.context).addProducts([
      { displayName: "Noise-Cancelling Headset", quantity: 1 },
    ]);

    const second = await openScenario("state-reader");
    const navigation = new ShopNavigationService(second.context);
    expect((await navigation.open("catalogue")).landedOn).toBe("sign-in");

    // The cart belongs to the session, so a fresh context cannot see the other goods.
    expect((await navigation.open("cart")).landedOn).toBe("sign-in");

    await finish(first);
    await finish(second);
  });

  it("reports a rejected sign-in without keeping the credential on the page", async () => {
    const scenario = await openScenario("rejected");
    const service = new SignInService(scenario.context);

    const outcome = await service.attempt({
      username: scenario.data.accountName,
      password: REJECTED_PASSWORD,
    });

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") {
      throw new Error("Expected the fixture to refuse a password that breaks its policy.");
    }

    expect(outcome.passwordCleared).toBe(true);
    expect(outcome.credentialInMarkup).toBe(false);
    expect(outcome.message.toLowerCase()).toContain("sign in failed");

    // Two refusals that differ in wording would let a probe enumerate account names.
    const unknownAccount = await service.attempt({
      username: "nobody",
      password: REJECTED_PASSWORD,
    });
    if (unknownAccount.status === "rejected") {
      expect(unknownAccount.message).toBe(outcome.message);
    } else {
      throw new Error("The fixture accepted an account that does not exist.");
    }

    await finish(scenario);
  });

  it("never writes a credential or form content to the log", async () => {
    const scenario = await openScenario("log-hygiene");
    await signIn(scenario);

    const cart = new CartService(scenario.context);
    await cart.addProducts([{ displayName: "Braided USB-C Cable", quantity: 1 }]);

    await new CheckoutService(scenario.context).placeOrder({
      postalCode: scenario.data.postalCode,
      deliveryNote: scenario.data.deliveryNote,
    });

    const written = loggedText(scenario.log);
    // The two stages that would leak most easily must have logged at all, or the
    // absence checks below would pass on a run that never reached them.
    expect(scenario.log.sink.find("Shop sign in succeeded")).toBeDefined();
    expect(scenario.log.sink.find("Order confirmed")).toBeDefined();

    expect(written).not.toContain(scenario.data.password);
    expect(written).not.toContain(scenario.data.deliveryNote);
    expect(written).not.toContain(scenario.data.token);
    // Matched as a JSON string value: a bare five-digit code would also occur inside
    // legitimate logged amounts, and a test that fails on those is noise.
    expect(written).not.toContain(`"${scenario.data.postalCode}"`);

    await finish(scenario);
  });

  it("keeps the password out of the markup while it is being typed", async () => {
    const scenario = await openScenario("masked");
    const page = await scenario.context.page();
    const service = new SignInService(scenario.context);

    const outcome = await service.attempt({
      username: scenario.data.accountName,
      password: scenario.data.password,
    });
    expect(outcome.status).toBe("authenticated");

    const markup = await page.content();
    expect(markup).not.toContain(scenario.data.password);

    await finish(scenario);
  });
});
