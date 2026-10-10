import type { ExecutionContext } from "../../../platform/contracts.js";
import { PlatformError, PlatformErrorCode } from "../../../platform/errors/index.js";
import { isAllowedQuantity, type CartLine, type CartTotals } from "../../../domains/shop/index.js";
import { shopPageUrl } from "../configuration.js";
import { CataloguePage, CartPage } from "../pages/index.js";
import { readRoute } from "../navigation.js";
import type { AddRequest, CheckoutArrival } from "./types.js";

/**
 * What the cart page displays. `displayed` is read from rendered money, and the caller
 * compares it against the domain's independent calculation; the service does not reconcile
 * the two, because a service that grades its own arithmetic proves nothing.
 */
export interface CartSnapshot {
  readonly lines: readonly CartLine[];
  readonly displayed: CartTotals;
  readonly isEmpty: boolean;
  readonly canProceedToCheckout: boolean;
}

export class CartService {
  private readonly context: ExecutionContext;

  constructor(context: ExecutionContext) {
    this.context = context;
  }

  async openCatalogue(): Promise<{ readonly productNames: readonly string[] }> {
    const catalogue = new CataloguePage(await this.context.page(), this.timeout());
    await catalogue.open(shopPageUrl(this.context.config, "catalogue"));
    const productNames = await catalogue.productNames();
    this.context.logger.debug("Catalogue opened.", { productCount: productNames.length });
    return { productNames };
  }

  /**
   * Quantities are validated before the page is touched. Submitting an impossible quantity
   * and then reporting whatever the application clamped it to would hide a mismatch
   * between what the test asked for and what it actually exercised.
   */
  async addProducts(requests: readonly AddRequest[]): Promise<CartSnapshot> {
    for (const request of requests) {
      if (!isAllowedQuantity(request.quantity)) {
        throw new PlatformError(
          PlatformErrorCode.BUSINESS_RULE_VIOLATED,
          `Quantity ${String(request.quantity)} for "${request.displayName}" is outside the allowed range.`,
          { severity: "warning", context: { ...request } },
        );
      }
    }

    await this.ensureCatalogue();

    const catalogue = new CataloguePage(await this.context.page(), this.timeout());
    for (const request of requests) {
      const badgeCount = await catalogue.addProduct(request.displayName, request.quantity);
      this.context.logger.debug("Product added.", {
        product: request.displayName,
        quantity: request.quantity,
        badgeCount,
      });
    }

    return this.readCart();
  }

  async openCart(): Promise<CartSnapshot> {
    const cart = new CartPage(await this.context.page(), this.timeout());
    await cart.open(shopPageUrl(this.context.config, "cart"));
    return this.snapshot(cart);
  }

  async setQuantity(displayName: string, quantity: number): Promise<CartSnapshot> {
    if (!isAllowedQuantity(quantity)) {
      throw new PlatformError(
        PlatformErrorCode.BUSINESS_RULE_VIOLATED,
        `Quantity ${String(quantity)} is outside the allowed range.`,
        { severity: "warning", context: { displayName, quantity } },
      );
    }

    const cart = await this.ensureCart();
    await cart.setQuantity(displayName, quantity);
    return this.snapshot(cart);
  }

  async remove(displayName: string): Promise<CartSnapshot> {
    const cart = await this.ensureCart();
    await cart.remove(displayName);
    return this.snapshot(cart);
  }

  async proceedToCheckout(): Promise<CheckoutArrival> {
    const cart = await this.ensureCart();

    if (!(await cart.canProceedToCheckout())) {
      return { status: "redirected", reason: "empty-cart" };
    }

    await cart.proceedToCheckout("checkout");
    return { status: "checkout" };
  }

  private async readCart(): Promise<CartSnapshot> {
    const cart = new CartPage(await this.context.page(), this.timeout());
    await cart.open(shopPageUrl(this.context.config, "cart"));
    return this.snapshot(cart);
  }

  private async ensureCart(): Promise<CartPage> {
    const cart = new CartPage(await this.context.page(), this.timeout());
    if ((await readRoute(await this.context.page())) !== "cart") {
      await cart.open(shopPageUrl(this.context.config, "cart"));
    }
    return cart;
  }

  private async ensureCatalogue(): Promise<void> {
    const page = await this.context.page();
    if ((await readRoute(page)) !== "catalogue") {
      await this.openCatalogue();
    }
  }

  private async snapshot(cart: CartPage): Promise<CartSnapshot> {
    const [lines, displayed, isEmpty, canProceedToCheckout] = await Promise.all([
      cart.lines(),
      cart.totals(),
      cart.isEmpty(),
      cart.canProceedToCheckout(),
    ]);

    return { lines, displayed, isEmpty, canProceedToCheckout };
  }

  private timeout(): number {
    return this.context.config.browser.timeouts.navigationMs;
  }
}
