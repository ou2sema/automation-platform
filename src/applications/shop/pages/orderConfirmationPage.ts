import type { Page } from "playwright";

import { parseCount, parseMoneyToCents } from "../display.js";

const REFERENCE = "[data-testid='order-reference']";
const TOTAL = "[data-testid='order-total']";
const ITEM_COUNT = "[data-testid='order-count']";
const PLACED_COUNT = "[data-testid='placed-count']";

export interface OrderConfirmation {
  readonly reference: string;
  readonly totalCents: number;
  readonly itemCount: number;
  /**
   * How many orders exist in this session. The flow asserts this is exactly one, which
   * is what proves the non-idempotent submit was not replayed.
   */
  readonly ordersInSession: number;
}

export class OrderConfirmationPage {
  readonly page: Page;
  private readonly timeoutMs: number;

  constructor(page: Page, timeoutMs: number) {
    this.page = page;
    this.timeoutMs = timeoutMs;
  }

  async open(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
  }

  async read(): Promise<OrderConfirmation> {
    return {
      reference: (await this.page.locator(REFERENCE).textContent())?.trim() ?? "",
      totalCents: parseMoneyToCents((await this.page.locator(TOTAL).textContent()) ?? ""),
      itemCount: parseCount((await this.page.locator(ITEM_COUNT).textContent()) ?? ""),
      ordersInSession: parseCount((await this.page.locator(PLACED_COUNT).textContent()) ?? ""),
    };
  }
}
