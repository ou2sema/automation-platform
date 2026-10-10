import type { Page } from "playwright";

import type { ShopRoute } from "../configuration.js";
import { readRoute } from "../navigation.js";

/**
 * Visiting a shop URL and reporting where the browser ended up.
 *
 * Access-control scenarios want the redirect itself as the result, so nothing is assumed
 * about the route that answers: the page that was asked for may be the page the browser
 * is on. This class exists so a Service can ask a page object that question instead of
 * driving the browser itself.
 */
export class ShopPage {
  readonly page: Page;
  private readonly timeoutMs: number;

  constructor(page: Page, timeoutMs: number) {
    this.page = page;
    this.timeoutMs = timeoutMs;
  }

  /** The route actually displayed, which may differ from the route that was requested. */
  async open(url: string): Promise<ShopRoute | null> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
    return readRoute(this.page);
  }

  landedUrl(): string {
    return this.page.url();
  }
}
