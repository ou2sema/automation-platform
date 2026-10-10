import { readFile } from "node:fs/promises";

import { World, type ITestCaseHookParameter, type IWorldOptions } from "@cucumber/cucumber";
import type { Page } from "playwright";

import { BrowserSession } from "../browser/index.js";
import type { ExecutionContext } from "../contracts.js";
import type { PlatformConfiguration } from "../configuration/index.js";
import type { ResolutionScope } from "../dependency-injection/index.js";
import type { ScenarioResultStatus } from "../events/types.js";
import { PlatformError, PlatformErrorCode } from "../errors/index.js";
import { createId, type CorrelationIds } from "../observability/correlation.js";
import type { PlatformLogger } from "../observability/logger.js";
import { requireRunContext, type RunContext } from "../runtime/runContext.js";
import { BrowserManagerToken, BrowserSessionToken } from "../tokens.js";

export interface PlatformWorldParameters {
  readonly runLabel: string;
}

/**
 * Scenario-scoped execution context handed to every step definition.
 *
 * Holds exactly one scenario's state: its correlation, its DI scope and (lazily) its
 * browser session. Nothing here is shared between scenarios, and the browser session
 * is created only when a scenario actually asks for a page, so API-only scenarios
 * pay no browser cost.
 */
export class PlatformWorld extends World<PlatformWorldParameters> implements ExecutionContext {
  readonly run: RunContext;
  readonly scenarioId: string;
  readonly scope: ResolutionScope;

  logger: PlatformLogger;

  private readonly scratch = new Map<string, unknown>();
  private readonly startedAt: number;
  private correlationValue: CorrelationIds;
  private browserSession: BrowserSession | undefined;
  private scenarioName = "unnamed scenario";
  private scenarioUri = "";
  private scenarioTags: readonly string[] = [];

  constructor(options: IWorldOptions<PlatformWorldParameters>) {
    super(options);
    this.run = requireRunContext();
    this.scenarioId = createId("scen");
    this.correlationValue = { runId: this.run.runId, scenarioId: this.scenarioId };
    this.logger = this.run.logger.child({ scenarioId: this.scenarioId });
    this.scope = this.run.container.createScenarioScope(this.run.scope);
    this.startedAt = Date.now();
  }

  get config(): PlatformConfiguration {
    return this.run.config;
  }

  get correlation(): CorrelationIds {
    return this.correlationValue;
  }

  get tags(): readonly string[] {
    return this.scenarioTags;
  }

  get name(): string {
    return this.scenarioName;
  }

  /** Called from the Before hook, which is where Cucumber exposes scenario metadata. */
  configureScenario(parameter: ITestCaseHookParameter): void {
    this.scenarioName = parameter.pickle.name;
    this.scenarioUri = parameter.pickle.uri;
    this.scenarioTags = parameter.pickle.tags.map((tag) => tag.name);
    this.correlationValue = {
      ...this.correlationValue,
      scenarioName: this.scenarioName,
    };
    this.logger = this.run.logger.child({
      scenarioId: this.scenarioId,
      scenarioName: this.scenarioName,
    });

    this.run.eventBus.emit(
      "scenario.started",
      { scenarioName: this.scenarioName, uri: this.scenarioUri, tags: this.scenarioTags },
      this.correlationValue,
    );
  }

  /** Lazily create this scenario's isolated browser context and page. */
  async session(): Promise<BrowserSession> {
    if (this.browserSession !== undefined) {
      return this.browserSession;
    }

    const manager = await this.run.scope.resolve(BrowserManagerToken);
    const browser = await manager.acquire();
    const session = await BrowserSession.create({
      browser,
      config: this.config,
      logger: this.logger,
      correlation: this.correlationValue,
      eventBus: this.run.eventBus,
    });

    // Published into the scenario scope so Jobs resolve this same instance and it
    // is disposed with the scenario even if a step forgets to clean up.
    this.scope.provideInstance(BrowserSessionToken, session);
    this.browserSession = session;
    return session;
  }

  /** Convenience for steps that only need the primary page. */
  async page(): Promise<Page> {
    const session = await this.session();
    return session.page;
  }

  /**
   * Scenario-scoped scratch space for passing a Job result from one step to the
   * next. Safe precisely because the World is per-scenario; it is never a place for
   * cross-scenario state, and it is discarded with the scenario.
   */
  remember<T>(key: string, value: T): void {
    this.scratch.set(key, value);
  }

  recall<T>(key: string): T {
    if (!this.scratch.has(key)) {
      throw new PlatformError(
        PlatformErrorCode.ASSERTION_FAILED,
        `Step expected scenario value "${key}" but it was never produced. A preceding step likely did not run.`,
        { context: { key, scenarioId: this.scenarioId } },
      );
    }
    return this.scratch.get(key) as T;
  }

  /**
   * Whether a step has already produced a value, for steps that accumulate results across
   * several iterations. Reading without checking is not an option, because `recall`
   * deliberately fails when a value was never written.
   */
  has(key: string): boolean {
    return this.scratch.has(key);
  }

  /**
   * Teardown for one scenario. The outcome is recorded *before* disposal so
   * artifact-retention decisions use the real result rather than a guess.
   */
  async finish(status: ScenarioResultStatus): Promise<void> {
    let artifactPaths: readonly string[] = [];

    if (this.browserSession !== undefined) {
      this.browserSession.recordStatus(status);

      if (status === "failed") {
        const shot = await this.browserSession.captureScreenshot(`${this.scenarioId}-failure`);
        if (shot !== undefined) {
          await this.attachScreenshot(shot.path);
        }
      }

      const result = await this.browserSession.close();
      artifactPaths = result.artifacts.map((artifact) => artifact.path);
    }

    this.run.eventBus.emit(
      "scenario.finished",
      {
        scenarioName: this.scenarioName,
        status,
        durationMs: Date.now() - this.startedAt,
        artifactPaths,
      },
      this.correlationValue,
    );

    await this.scope.dispose();
  }

  private async attachScreenshot(filePath: string): Promise<void> {
    try {
      const data = await readFile(filePath);
      // `attach` itself is synchronous for Buffer and string payloads; awaiting it
      // would be meaningless, but the read must finish before teardown continues so
      // the attachment is recorded against this scenario.
      this.attach(data, "image/png");
      this.attach(`screenshot: ${filePath}`, "text/plain");
    } catch (cause) {
      this.logger.errorFrom(cause, "Failure screenshot could not be attached to the report.", {
        filePath,
      });
    }
  }
}
