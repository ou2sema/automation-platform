import type { Page } from "playwright";

import type { PlatformConfiguration } from "./configuration/index.js";
import type { CorrelationIds } from "./observability/correlation.js";
import type { PlatformLogger } from "./observability/logger.js";

/**
 * The boundary Jobs and Services are allowed to see.
 *
 * Jobs depend on this interface rather than on the Cucumber `World`, which keeps
 * business workflows free of test-runner machinery: the same Job must be callable
 * from a step definition today and from a scheduled runner or an API-only suite
 * tomorrow.
 */
export interface ExecutionContext {
  readonly correlation: CorrelationIds;
  readonly logger: PlatformLogger;
  readonly config: PlatformConfiguration;
  /** Scenario-isolated browser page, created on first use. */
  page(): Promise<Page>;
}
