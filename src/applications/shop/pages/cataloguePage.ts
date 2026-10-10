import type { Locator, Page } from "playwright";

import type { ShopRoute } from "../configuration.js";
import { parseCount } from "../display.js";
import { requireOne, waitForRoute } from "../navigation.js";

const PRODUCT = "[data-testid='product']";
const PRODUCT_NAME = "[data-testid='product-name']";
const PRODUCT_QUANTITY = "[data-testid='product-quantity']";
const ADD_TO_CART = "[data-testid='add-to-cart']";
const CART_COUNT = "[data-testid='cart-count']";
const CURRENT_USER = "[data-testid='current-user']";
const OPEN_CART = "[data-testid='open-cart']";

export class CataloguePage {
  readonly page: Page;
  private readonly timeoutMs: number;

  constructor(page: Page, timeoutMs: number) {
    this.page = page;
    this.timeoutMs = timeoutMs;
  }

  async open(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
  }

  /** Rows are addressed by the product name a customer would read, never by index. */
  rowFor(displayName: string): Locator {
    return this.page.locator(PRODUCT, { has: this.page.getByText(displayName, { exact: true }) });
  }

  /**
   * Adding to the cart does not navigate, so the badge is read back as the proof the
   * interaction took effect.
   */
  async addProduct(displayName: string, quantity: number): Promise<number> {
    const row = this.rowFor(displayName);
    await requireOne(row, `the catalogue row for "${displayName}"`);

    const quantityField = row.locator(PRODUCT_QUANTITY);
    const addButton = row.locator(ADD_TO_CART);
    await requireOne(quantityField, `the quantity field for "${displayName}"`);
    await requireOne(addButton, `the add button for "${displayName}"`);

    await quantityField.fill(String(quantity));
    await addButton.click();

    return this.cartBadgeCount();
  }

  async cartBadgeCount(): Promise<number> {
    return parseCount((await this.page.locator(CART_COUNT).textContent()) ?? "");
  }

  async currentUserName(): Promise<string> {
    return (await this.page.locator(CURRENT_USER).textContent())?.trim() ?? "";
  }

  async productNames(): Promise<string[]> {
    return (await this.page.locator(PRODUCT_NAME).allTextContents()).map((name) => name.trim());
  }

  async goToCart(route: ShopRoute): Promise<void> {
    const link = this.page.locator(OPEN_CART);
    await requireOne(link, "the cart link");
    await link.click();
    await waitForRoute(this.page, route, this.timeoutMs);
  }
}
