import { chromium, firefox, webkit, type Browser, type BrowserType } from "playwright";

import type { PlatformConfiguration } from "../configuration/index.js";
import { BrowserLifecycleError, PlatformErrorCode } from "../errors/index.js";
import type { PlatformEventBus } from "../events/index.js";
import type { PlatformLogger } from "../observability/logger.js";
import { withTimeout } from "../timing/index.js";

/** Chromium-only flags that make headless runs behave in CI containers. */
const CONTAINER_ARGS = ["--disable-dev-shm-usage"] as const;

export interface BrowserManagerDependencies {
  readonly config: PlatformConfiguration;
  readonly logger: PlatformLogger;
  readonly eventBus?: PlatformEventBus;
}

/**
 * Owns the browser *process*, which is shared across scenarios for speed.
 *
 * Sharing a browser is safe; sharing a context is not. Isolation is provided by
 * `BrowserSession`, which creates a fresh context per scenario.
 */
export class BrowserManager {
  private browser: Browser | undefined;
  private launching: Promise<Browser> | undefined;
  private closed = false;

  private readonly config: PlatformConfiguration;
  private readonly logger: PlatformLogger;
  private readonly eventBus: PlatformEventBus | undefined;

  constructor(dependencies: BrowserManagerDependencies) {
    this.config = dependencies.config;
    this.logger = dependencies.logger;
    this.eventBus = dependencies.eventBus;
  }

  get isLaunched(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  get version(): string | undefined {
    return this.browser?.version();
  }

  async acquire(): Promise<Browser> {
    if (this.closed) {
      throw new BrowserLifecycleError(
        PlatformErrorCode.BROWSER_NOT_AVAILABLE,
        "BrowserManager is closed; a browser cannot be acquired after the run finished.",
        { context: { browserName: this.config.browser.name } },
      );
    }
    if (this.browser !== undefined) {
      return this.browser;
    }
    // Collapse concurrent first-use launches into one process.
    this.launching ??= this.launch();
    return this.launching;
  }

  async close(): Promise<void> {
    this.closed = true;
    const browser = this.browser;
    this.browser = undefined;
    this.launching = undefined;
    if (browser === undefined) {
      return;
    }
    try {
      // Playwright 1.64 removed the timeout option from Browser.close(), so the
      // configured bound is enforced by racing instead of by the API.
      await withTimeout(
        browser.close({ reason: "automation run finished" }),
        this.config.browser.timeouts.closeMs,
        `Closing the ${this.config.browser.name} browser process`,
      );
    } catch (cause) {
      throw new BrowserLifecycleError(
        PlatformErrorCode.BROWSER_CLOSE_FAILED,
        `Failed to close the ${this.config.browser.name} browser process.`,
        { cause, context: { browserName: this.config.browser.name } },
      );
    }
  }

  /** Matches the DI `Disposable` shape so the run scope tears this down. */
  async dispose(): Promise<void> {
    await this.close();
  }

  private async launch(): Promise<Browser> {
    const { browser } = this.config;
    const startedAt = Date.now();
    const browserType: BrowserType = selectBrowserType(browser.name);

    this.logger.debug("Launching browser process.", {
      browserName: browser.name,
      headless: browser.headless,
    });

    try {
      const launched = await browserType.launch({
        headless: browser.headless,
        ...(browser.name === "chromium" ? { args: [...CONTAINER_ARGS] } : {}),
      });
      this.browser = launched;

      const durationMs = Date.now() - startedAt;
      this.eventBus?.emit("browser.launched", {
        browserName: browser.name,
        headless: browser.headless,
        version: launched.version(),
        launchDurationMs: durationMs,
      });
      this.logger.info("Browser process ready.", {
        browserName: browser.name,
        version: launched.version(),
        launchDurationMs: durationMs,
      });
      return launched;
    } catch (cause) {
      this.launching = undefined;
      throw new BrowserLifecycleError(
        PlatformErrorCode.BROWSER_LAUNCH_FAILED,
        withLaunchHint(cause, browser.name),
        { cause, context: { browserName: browser.name, headless: browser.headless } },
      );
    }
  }
}

function selectBrowserType(name: PlatformConfiguration["browser"]["name"]): BrowserType {
  switch (name) {
    case "chromium":
      return chromium;
    case "firefox":
      return firefox;
    case "webkit":
      return webkit;
    default: {
      // The validated configuration schema cannot produce this, so it is only
      // reachable through untyped direct API use.
      const exhausted: never = name;
      throw new BrowserLifecycleError(
        PlatformErrorCode.BROWSER_LAUNCH_FAILED,
        "Unsupported browser name in configuration.",
        { context: { browserName: exhausted } },
      );
    }
  }
}

/**
 * Turn the usual "browser not installed" failure into an instruction, because a
 * raw Playwright path error tells a new engineer nothing.
 */
function withLaunchHint(cause: unknown, browserName: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const looksMissing =
    /executable doesn't exist|browserType\.launch: .*executable|please run.*install|is not supported|Please install/i.test(
      message,
    );

  if (looksMissing) {
    return (
      `Unable to launch the ${browserName} browser because its executable is missing. ` +
      `Run "npm run install:browsers" (installs Playwright browsers for the pinned version). ` +
      `Original error: ${message}`
    );
  }
  return `Unable to launch the ${browserName} browser. Original error: ${message}`;
}
