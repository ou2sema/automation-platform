import type { Page } from "playwright";

import { PlatformError, PlatformErrorCode } from "../../../platform/errors/index.js";

/**
 * The Phase 1 health fixture, described as a page object.
 *
 * This exists so the locator rule has no exceptions: reading `[data-testid=...]` from a
 * Job was acceptable while the Page Object layer was still a promise, and is not now that
 * it exists. The job still decides what a failure means; this class only says what the
 * page shows.
 */
const STATUS = "[data-testid='health-status']";

export class HealthPage {
  readonly page: Page;
  private readonly timeoutMs: number;

  constructor(page: Page, timeoutMs: number) {
    this.page = page;
    this.timeoutMs = timeoutMs;
  }

  async open(url: string): Promise<void> {
    const response = await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: this.timeoutMs,
    });

    if (response !== null && !response.ok()) {
      throw new PlatformError(
        PlatformErrorCode.NAVIGATION_FAILED,
        `Loading the health fixture returned status ${String(response.status())}.`,
        { context: { url, status: response.status() } },
      );
    }
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  async readyState(): Promise<string> {
    // In-page functions are serialised into the browser, so they cannot reference
    // imported helpers or the Node type environment. The inline cast describes only
    // the browser global this line needs.
    return this.page.evaluate(
      () => (globalThis as unknown as { document: { readyState: string } }).document.readyState,
    );
  }

  /** Text written by the page's own script, which proves JavaScript ran in a real browser. */
  async statusText(): Promise<string> {
    return (await this.page.locator(STATUS).textContent())?.trim() ?? "";
  }
}
