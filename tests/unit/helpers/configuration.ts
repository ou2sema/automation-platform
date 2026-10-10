import type { EnvSource, PlatformConfiguration } from "../../../src/index.js";
import { loadConfiguration } from "../../../src/index.js";

/** Build a validated configuration from an explicit environment, for tests only. */
export function makeConfiguration(
  overrides: Record<string, string | undefined> = {},
): PlatformConfiguration {
  const env: EnvSource = {
    AP_RUN_LABEL: "unit-test",
    AP_LOG_LEVEL: "info",
    ...overrides,
  };
  return loadConfiguration({ envSource: env, projectRoot: process.cwd() });
}
