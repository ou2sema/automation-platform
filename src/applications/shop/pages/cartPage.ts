import type { Locator, Page } from "playwright";

import type { ShopRoute } from "../configuration.js";
import type { CartLine, CartTotals } from "../../../domains/shop/index.js";
import { parseCount, parseMoneyToCents, parseShippingToCents } from "../display.js";
import { requireOne, waitForRoute } from "../navigation.js";

const LINE = "[data-testid='cart-line']";
const LINE_NAME = "[data-testid='line-name']";
const LINE_UNIT_PRICE = "[data-testid='line-unit-price']";
const LINE_QUANTITY = "[data-testid='line-quantity']";
const LINE_REMOVE = "[data-testid='line-remove']";
const SUBTOTAL = "[data-testid='cart-subtotal']";
const SHIPPING = "[data-testid='cart-shipping']";
const TAX = "[data-testid='cart-tax']";
const TOTAL = "[data-testid='cart-total']";
const COUNT = "[data-testid='cart-count']";
const EMPTY_STATE = "[data-testid='empty-cart']";
const PROCEED = "[data-testid='proceed-to-checkout']";

export class CartPage {
  readonly page: Page;
  private readonly timeoutMs: number;

  constructor(page: Page, timeoutMs: number) {
    this.page = page;
    this.timeoutMs = timeoutMs;
  }

  async open(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
  }

  lineFor(displayName: string): Locator {
    return this.page.locator(LINE, { has: this.page.getByText(displayName, { exact: true }) });
  }

  /**
   * Reads exactly what the cart displays. No arithmetic is performed here: the caller
   * compares these figures against the domain's own calculation, which is what turns a
   * rendered number into a verified one.
   */
  async lines(): Promise<CartLine[]> {
    const rows = this.page.locator(LINE);
    const count = await rows.count();
    const result: CartLine[] = [];

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      result.push({
        sku: (await row.getAttribute("data-sku")) ?? "",
        displayName: (await row.locator(LINE_NAME).textContent())?.trim() ?? "",
        unitPriceCents: parseMoneyToCents((await row.locator(LINE_UNIT_PRICE).textContent()) ?? ""),
        quantity: parseCount((await row.locator(LINE_QUANTITY).inputValue()) ?? ""),
      });
    }

    return result;
  }

  async totals(): Promise<CartTotals> {
    return {
      subtotalCents: parseMoneyToCents((await this.page.locator(SUBTOTAL).textContent()) ?? ""),
      shippingCents: parseShippingToCents((await this.page.locator(SHIPPING).textContent()) ?? ""),
      taxCents: parseMoneyToCents((await this.page.locator(TAX).textContent()) ?? ""),
      totalCents: parseMoneyToCents((await this.page.locator(TOTAL).textContent()) ?? ""),
      itemCount: parseCount((await this.page.locator(COUNT).textContent()) ?? ""),
    };
  }

  async isEmpty(): Promise<boolean> {
    return this.page.locator(EMPTY_STATE).isVisible();
  }

  async setQuantity(displayName: string, quantity: number): Promise<void> {
    const row = this.lineFor(displayName);
    await requireOne(row, `the cart line for "${displayName}"`);

    const field = row.locator(LINE_QUANTITY);
    await requireOne(field, `the quantity field for "${displayName}"`);

    // fill() dispatches both input and change, which is what the page listens for.
    await field.fill(String(quantity));
    await field.blur();
  }

  async remove(displayName: string): Promise<void> {
    const row = this.lineFor(displayName);
    await requireOne(row, `the cart line for "${displayName}"`);

    const button = row.locator(LINE_REMOVE);
    await requireOne(button, `the remove control for "${displayName}"`);
    await button.click();
  }

  /**
   * The page disables this control for an empty cart. Reporting that state is more
   * useful than clicking a disabled button and reporting the resulting timeout.
   */
  async canProceedToCheckout(): Promise<boolean> {
    return !(await this.page.locator(PROCEED).isDisabled());
  }

  async proceedToCheckout(route: ShopRoute): Promise<void> {
    const button = this.page.locator(PROCEED);
    await requireOne(button, "the checkout button");
    await button.click();
    await waitForRoute(this.page, route, this.timeoutMs);
  }
}
