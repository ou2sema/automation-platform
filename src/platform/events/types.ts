import type { ErrorReport } from "../errors/index.js";
import type { CorrelationIds } from "../observability/correlation.js";
import type { PlatformConfiguration } from "../configuration/schema.js";

/** Cucumber result statuses the platform mirrors. */
export type ScenarioResultStatus =
  "passed" | "failed" | "skipped" | "undefined" | "pending" | "ambiguous";

/**
 * Typed event contracts.
 *
 * The catalogue is a map so a consumer can be typed by event name, and adding a
 * Phase 4-8 recovery or integration event means adding a map entry, not widening a
 * loose payload. Payloads carry diagnostics only: never secrets, never raw form
 * values, never full DOM snapshots.
 */
export interface PlatformEventMap {
  "run.started": {
    readonly label: string;
    readonly configuration: Record<string, unknown>;
  };
  "run.finished": {
    readonly outcome: "completed" | "aborted";
    readonly durationMs: number;
  };
  "scenario.started": {
    readonly scenarioName: string;
    readonly uri: string;
    readonly tags: readonly string[];
  };
  "scenario.finished": {
    readonly scenarioName: string;
    readonly status: ScenarioResultStatus;
    readonly durationMs: number;
    readonly artifactPaths: readonly string[];
  };
  "browser.launched": {
    readonly browserName: string;
    readonly headless: boolean;
    readonly version: string;
    readonly launchDurationMs: number;
  };
  "browser.context.created": {
    readonly browserName: string;
    readonly traceEnabled: boolean;
    readonly videoEnabled: boolean;
  };
  "browser.context.closed": {
    readonly browserName: string;
    readonly artifactPath?: string;
  };
  "failure.recorded": {
    readonly scenarioName: string;
    readonly report: ErrorReport;
  };
}

export type PlatformEventType = keyof PlatformEventMap;

export type PlatformEventPayload<T extends PlatformEventType> = PlatformEventMap[T];

export interface EventEnvelope<T extends PlatformEventType> {
  readonly type: T;
  readonly payload: PlatformEventPayload<T>;
  readonly correlation: CorrelationIds;
  readonly emittedAt: string;
  readonly source: string;
}

export type EventHandler<T extends PlatformEventType> = (
  envelope: EventEnvelope<T>,
) => void | Promise<void>;

/**
 * Event payloads must not embed credentials. This helper exists so `run.started`
 * can carry configuration shape without the `secrets` node.
 */
export function describeConfigurationForEvent(
  config: PlatformConfiguration,
): Record<string, unknown> {
  return {
    run: config.run,
    logging: config.logging,
    browser: config.browser,
    paths: config.paths,
    application: config.application,
    recovery: config.recovery,
    healingMemory: config.healingMemory,
    integrations: config.integrations,
  };
}
