import type { Page } from "playwright";

import { parseMoneyToCents } from "../display.js";
import { requireOne } from "../navigation.js";

const LINE = "[data-testid='checkout-line']";
const TOTAL = "[data-testid='checkout-total']";
const POSTAL_CODE = "[data-testid='postal-code']";
const DELIVERY_NOTE = "[data-testid='delivery-note']";
const PLACE_ORDER = "[data-testid='place-order']";
const CHECKOUT_ERROR = "[data-testid='checkout-error']";

export interface CheckoutFormInput {
  readonly postalCode: string;
  readonly deliveryNote: string;
}

export class CheckoutPage {
  readonly page: Page;
  private readonly timeoutMs: number;

  constructor(page: Page, timeoutMs: number) {
    this.page = page;
    this.timeoutMs = timeoutMs;
  }

  async open(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
  }

  async lineCount(): Promise<number> {
    return this.page.locator(LINE).count();
  }

  async displayedTotalCents(): Promise<number> {
    return parseMoneyToCents((await this.page.locator(TOTAL).textContent()) ?? "");
  }

  /**
   * Submitting the order is the only non-idempotent action in the flow: it writes an
   * order and empties the cart. The control is re-checked immediately before the click
   * so a second submit cannot slip through, and the caller verifies afterwards that
   * exactly one order exists.
   */
  async submit(input: CheckoutFormInput): Promise<void> {
    const postalField = this.page.locator(POSTAL_CODE);
    const noteField = this.page.locator(DELIVERY_NOTE);
    const placeButton = this.page.locator(PLACE_ORDER);

    await requireOne(postalField, "the postal code field");
    await requireOne(noteField, "the delivery note field");
    await requireOne(placeButton, "the place order button");

    await postalField.fill(input.postalCode);
    await noteField.fill(input.deliveryNote);

    if (await placeButton.isDisabled()) {
      return;
    }
    await placeButton.click();
  }

  async isPlaceOrderDisabled(): Promise<boolean> {
    return this.page.locator(PLACE_ORDER).isDisabled();
  }

  /**
   * Resolves when the page has displayed a rejection, so a refused order is detected as an
   * event instead of inferred from a missing navigation.
   */
  rejectionSignal(timeoutMs: number): Promise<void> {
    return this.page.locator(CHECKOUT_ERROR).waitFor({ state: "visible", timeout: timeoutMs });
  }

  async rejectionMessage(): Promise<string | null> {
    const error = this.page.locator(CHECKOUT_ERROR);
    if (!(await error.isVisible())) {
      return null;
    }
    return (await error.textContent())?.trim() ?? "";
  }
}
