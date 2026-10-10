import { createToken } from "./dependency-injection/index.js";
import type { PlatformConfiguration } from "./configuration/index.js";
import type { PlatformEventBus } from "./events/index.js";
import type { BrowserManager, BrowserSession } from "./browser/index.js";
import type { PlatformLogger } from "./observability/logger.js";

/**
 * Cross-cutting platform tokens.
 *
 * `configuration`, `logger`, `eventBus` and `browserManager` are run-scoped: one
 * instance per run is what keeps correlation ids, event ordering and the shared
 * browser process coherent. `browserSession` is scenario-scoped, because isolation
 * is the contract: every scenario gets its own context, cookies and artifacts.
 */
export const ConfigurationToken = createToken<PlatformConfiguration>("platform/configuration");
export const LoggerToken = createToken<PlatformLogger>("platform/logger");
export const EventBusToken = createToken<PlatformEventBus>("platform/event-bus");
export const BrowserManagerToken = createToken<BrowserManager>("platform/browser-manager");
export const BrowserSessionToken = createToken<BrowserSession>("platform/browser-session");
