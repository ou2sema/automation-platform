import { BrowserManager } from "../browser/index.js";
import {
  describeConfiguration,
  loadConfiguration,
  type PlatformConfiguration,
} from "../configuration/index.js";
import { DependencyContainer, type ResolutionScope } from "../dependency-injection/index.js";
import { PlatformEventBus } from "../events/index.js";
import { describeConfigurationForEvent } from "../events/types.js";
import { PlatformError, PlatformErrorCode } from "../errors/index.js";
import { createLogger, type PlatformLogger } from "../observability/logger.js";
import { createRunId, type CorrelationIds } from "../observability/correlation.js";
import {
  BrowserManagerToken,
  BrowserSessionToken,
  ConfigurationToken,
  EventBusToken,
  LoggerToken,
} from "../tokens.js";

export interface RunContext {
  readonly runId: string;
  readonly correlation: CorrelationIds;
  readonly config: PlatformConfiguration;
  readonly logger: PlatformLogger;
  readonly eventBus: PlatformEventBus;
  readonly container: DependencyContainer;
  readonly scope: ResolutionScope;
  readonly startedAt: number;
}

export interface InitializeRunOptions {
  readonly configuration?: PlatformConfiguration;
  readonly runId?: string;
}

/**
 * Composition root.
 *
 * This module holds the only intentionally process-level mutable state in the
 * platform: one run context per Cucumber worker process. Scenario state is never
 * stored here; it lives in the per-scenario DI scope owned by the World. That
 * distinction is the whole isolation story, so it is asserted rather than assumed
 * (see `initializeRun`).
 */
let activeRun: RunContext | undefined;

export function initializeRun(options: InitializeRunOptions = {}): RunContext {
  if (activeRun !== undefined) {
    throw new PlatformError(
      PlatformErrorCode.DI_RESOLUTION_FAILED,
      "A run context already exists in this process. Shut it down before initialising another.",
      { context: { activeRunId: activeRun.runId } },
    );
  }

  const config = options.configuration ?? loadConfiguration();
  const runId = options.runId ?? createRunId(config.run.label);
  const correlation: CorrelationIds = { runId };
  const logger = createLogger(config, correlation);
  const eventBus = new PlatformEventBus({ runId, logger });
  const container = new DependencyContainer({ logger });
  const scope = container.createRunScope();

  container
    .register(ConfigurationToken, () => config, { scope: "run" })
    .register(LoggerToken, () => logger, { scope: "run" })
    .register(EventBusToken, () => eventBus, { scope: "run" })
    .register(
      BrowserManagerToken,
      async (resolution) =>
        new BrowserManager({
          config: await resolution.resolve(ConfigurationToken),
          logger: await resolution.resolve(LoggerToken),
          eventBus: await resolution.resolve(EventBusToken),
        }),
      { scope: "run" },
    )
    .register(
      BrowserSessionToken,
      () => {
        // The scenario World creates and provides the session, because only it knows
        // the scenario correlation that artifacts are namespaced by. Reaching this
        // factory means something resolved a session outside a scenario scope.
        throw new PlatformError(
          PlatformErrorCode.DI_RESOLUTION_FAILED,
          `No browser session was provided for the current scenario scope. Sessions are created lazily by the World (use world.session() or world.page()); resolving ${BrowserSessionToken.name} directly is only valid inside a scenario that already obtained one.`,
          { context: { scopeId: scope.id } },
        );
      },
      { scope: "scenario" },
    );

  const context: RunContext = {
    runId,
    correlation,
    config,
    logger,
    eventBus,
    container,
    scope,
    startedAt: Date.now(),
  };
  activeRun = context;

  logger.info("Run context initialised.", {
    runId: runId,
    browserName: config.browser.name,
    headless: config.browser.headless,
    recoveryMode: config.recovery.mode,
  });
  logger.debug("Effective configuration.", {
    configuration: describeConfiguration(config),
  });
  eventBus.emit("run.started", {
    label: config.run.label,
    configuration: describeConfigurationForEvent(config),
  });

  return context;
}

export function requireRunContext(): RunContext {
  if (activeRun === undefined) {
    throw new PlatformError(
      PlatformErrorCode.DI_RESOLUTION_FAILED,
      "No run context exists. Platform hooks must initialise the run before any scenario runs.",
    );
  }
  return activeRun;
}

export function hasRunContext(): boolean {
  return activeRun !== undefined;
}

export async function shutdownRun(
  options: { outcome?: "completed" | "aborted" } = {},
): Promise<void> {
  const context = activeRun;
  if (context === undefined) {
    return;
  }
  activeRun = undefined;

  const outcome = options.outcome ?? "completed";

  try {
    const manager = await context.scope.tryResolve(BrowserManagerToken);
    if (manager?.isLaunched) {
      await manager.close();
    }
  } catch (cause) {
    context.logger.errorFrom(cause, "Browser process did not close cleanly.");
  }

  context.eventBus.emit("run.finished", {
    outcome,
    durationMs: Date.now() - context.startedAt,
  });
  await context.eventBus.close();

  await context.scope.dispose();

  const stats = context.eventBus.stats();
  context.logger.info("Run context closed.", {
    outcome,
    durationMs: Date.now() - context.startedAt,
    events: stats,
    disposalErrors: context.scope.disposeErrors.length,
  });
}

/** Test seam: force-clear the run context without teardown. Never used by hooks. */
export function resetRunContextForTesting(): void {
  activeRun = undefined;
}
