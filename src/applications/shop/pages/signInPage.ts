import type { Page } from "playwright";

import { requireOne } from "../navigation.js";

/**
 * Sign-in page.
 *
 * Knows the fixture's controls and nothing else: no pricing rules, no eligibility
 * decisions, no recovery strategy. It returns what the page says and lets the service
 * decide what that means.
 */
const USERNAME = "[data-testid='username']";
const PASSWORD = "[data-testid='password']";
const SUBMIT = "[data-testid='sign-in-submit']";
const AUTH_ERROR = "[data-testid='auth-error']";
const NOTICE = "[data-testid='notice']";
const SESSION_USER = "[data-testid='session-user']";

export class SignInPage {
  readonly page: Page;
  private readonly timeoutMs: number;

  constructor(page: Page, timeoutMs: number) {
    this.page = page;
    this.timeoutMs = timeoutMs;
  }

  async open(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
  }

  async submit(username: string, password: string): Promise<void> {
    const usernameField = this.page.locator(USERNAME);
    const passwordField = this.page.locator(PASSWORD);
    const submitButton = this.page.locator(SUBMIT);

    await requireOne(usernameField, "the account name field");
    await requireOne(passwordField, "the password field");
    await requireOne(submitButton, "the sign in button");

    await usernameField.fill(username);
    await passwordField.fill(password);
    await submitButton.click();
  }

  /**
   * The password field is emptied by the page on submit. Reading it is the only way to
   * prove no credential lingers in the DOM, and this method returns a boolean rather
   * than the value so callers cannot accidentally log what they read.
   */
  async passwordFieldIsClear(): Promise<boolean> {
    const value = await this.page.locator(PASSWORD).inputValue();
    return value.length === 0;
  }

  /**
   * Resolves when the page has positively displayed a rejection. Callers race this against
   * arrival at the catalogue, so a refused sign-in is detected as an event rather than
   * inferred from the absence of a navigation.
   */
  rejectionSignal(timeoutMs: number): Promise<void> {
    return this.page.locator(AUTH_ERROR).waitFor({ state: "visible", timeout: timeoutMs });
  }

  async rejectionMessage(): Promise<string | null> {
    const error = this.page.locator(AUTH_ERROR);
    if (!(await error.isVisible())) {
      return null;
    }
    return (await error.textContent())?.trim() ?? "";
  }

  async notice(): Promise<string | null> {
    const element = this.page.locator(NOTICE);
    if (!(await element.isVisible())) {
      return null;
    }
    return (await element.textContent())?.trim() ?? "";
  }

  async signedInDisplayName(): Promise<string | null> {
    const element = this.page.locator(SESSION_USER);
    if (!(await element.isVisible())) {
      return null;
    }
    return (await element.textContent())?.trim() ?? null;
  }

  /** The username is not a secret, but the page must not echo the submitted password. */
  async passwordAppearsInDom(needle: string): Promise<boolean> {
    const html = await this.page.content();
    return needle.length > 0 && html.includes(needle);
  }
}
