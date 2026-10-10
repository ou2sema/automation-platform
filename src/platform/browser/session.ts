import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";

import type { PlatformConfiguration } from "../configuration/index.js";
import { BrowserLifecycleError, PlatformErrorCode } from "../errors/index.js";
import type { PlatformEventBus } from "../events/index.js";
import type { CorrelationIds } from "../observability/correlation.js";
import type { PlatformLogger } from "../observability/logger.js";
import type { ArtifactRecord, IBrowserSession, SessionCloseResult } from "./types.js";

export interface BrowserSessionDependencies {
  readonly browser: Browser;
  readonly config: PlatformConfiguration;
  readonly logger: PlatformLogger;
  readonly correlation: CorrelationIds;
  readonly eventBus?: PlatformEventBus;
}

/**
 * Scenario-scoped browser state.
 *
 * Isolation contract, stated explicitly because it is the load-bearing invariant
 * of the platform:
 *  - exactly one `BrowserContext` per scenario, never reused;
 *  - fresh cookies, storage, permissions and network state;
 *  - artifacts namespaced by run and scenario, so parallel workers cannot collide;
 *  - disposal always runs, even after a failure, so contexts cannot accumulate.
 */
export class BrowserSession implements IBrowserSession {
  readonly context: BrowserContext;
  readonly page: Page;

  private readonly config: PlatformConfiguration;
  private readonly logger: PlatformLogger;
  private readonly eventBus: PlatformEventBus | undefined;
  private readonly scenarioId: string;
  private readonly artifactDirectory: string;
  private readonly traceRequested: boolean;
  private readonly videoRequested: boolean;

  private traceStarted = false;
  private status = "unknown";
  private closed = false;
  private captured: ArtifactRecord[] = [];

  private constructor(
    context: BrowserContext,
    page: Page,
    options: {
      config: PlatformConfiguration;
      logger: PlatformLogger;
      eventBus?: PlatformEventBus;
      scenarioId: string;
      artifactDirectory: string;
    },
  ) {
    this.context = context;
    this.page = page;
    this.config = options.config;
    this.logger = options.logger;
    this.eventBus = options.eventBus;
    this.scenarioId = options.scenarioId;
    this.artifactDirectory = options.artifactDirectory;
    this.traceRequested = options.config.browser.traceMode !== "off";
    this.videoRequested = options.config.browser.videoMode !== "off";
  }

  static async create(deps: BrowserSessionDependencies): Promise<BrowserSession> {
    const { config, logger, correlation } = deps;
    const scenarioId = correlation.scenarioId ?? "unscoped";
    const artifactDirectory = path.join(
      config.paths.artifactsDir,
      sanitize(correlation.runId),
      sanitize(scenarioId),
    );

    try {
      await mkdir(artifactDirectory, { recursive: true });
    } catch (cause) {
      throw new BrowserLifecycleError(
        PlatformErrorCode.BROWSER_CONTEXT_FAILED,
        `Cannot create the artifact directory for this scenario: ${artifactDirectory}`,
        { cause, context: { artifactDirectory } },
      );
    }

    const videoDirectory = path.join(artifactDirectory, "video");
    let context: BrowserContext;
    let page: Page;

    try {
      context = await deps.browser.newContext({
        viewport: {
          width: config.browser.viewport.width,
          height: config.browser.viewport.height,
        },
        locale: config.browser.locale,
        ...(config.browser.videoMode === "off" ? {} : { recordVideo: { dir: videoDirectory } }),
      });
      page = await context.newPage();
      page.setDefaultTimeout(config.browser.timeouts.actionMs);
      page.setDefaultNavigationTimeout(config.browser.timeouts.navigationMs);
    } catch (cause) {
      throw new BrowserLifecycleError(
        PlatformErrorCode.BROWSER_CONTEXT_FAILED,
        "Failed to create the isolated browser context for this scenario.",
        { cause, context: { scenarioId, artifactDirectory } },
      );
    }

    const session = new BrowserSession(context, page, {
      config,
      logger,
      ...(deps.eventBus === undefined ? {} : { eventBus: deps.eventBus }),
      scenarioId,
      artifactDirectory,
    });

    if (session.traceRequested) {
      try {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        session.traceStarted = true;
      } catch (cause) {
        // Tracing is a diagnostic, not a dependency: losing it must not fail a run.
        session.logger.errorFrom(cause, "Trace capture could not be started; continuing.");
      }
    }

    deps.eventBus?.emit("browser.context.created", {
      browserName: config.browser.name,
      traceEnabled: session.traceStarted,
      videoEnabled: session.videoRequested,
    });

    logger.debug("Isolated browser context created.", { artifactDirectory });
    return session;
  }

  get artifacts(): readonly ArtifactRecord[] {
    return this.captured;
  }

  get directory(): string {
    return this.artifactDirectory;
  }

  recordStatus(status: string): void {
    this.status = status;
  }

  async captureScreenshot(label: string): Promise<ArtifactRecord | undefined> {
    const file = path.join(this.artifactDirectory, `${sanitize(label)}.png`);
    try {
      await this.page.screenshot({ path: file, fullPage: true });
      const record: ArtifactRecord = { kind: "screenshot", path: file };
      this.captured = [...this.captured, record];
      return record;
    } catch (cause) {
      this.logger.errorFrom(cause, "Failure screenshot could not be captured.", { label });
      return undefined;
    }
  }

  async close(): Promise<SessionCloseResult> {
    if (this.closed) {
      return { artifacts: this.captured };
    }
    this.closed = true;

    const failed = this.status !== "passed" && this.status !== "skipped";
    const retainTrace = failed || this.config.browser.traceMode === "on";
    const retainVideo = failed || this.config.browser.videoMode === "on";

    if (this.traceStarted) {
      this.traceStarted = false;
      try {
        if (retainTrace) {
          const file = path.join(this.artifactDirectory, "trace.zip");
          await this.context.tracing.stop({ path: file });
          this.captured = [...this.captured, { kind: "trace", path: file }];
        } else {
          await this.context.tracing.stop();
        }
      } catch (cause) {
        this.logger.errorFrom(cause, "Trace finalisation failed.", { scenarioId: this.scenarioId });
      }
    }

    // The Video handle must be taken before the context closes.
    const video = this.page.video();

    try {
      await this.context.close();
    } catch (cause) {
      this.logger.errorFrom(cause, "Browser context close failed.", {
        scenarioId: this.scenarioId,
      });
    }

    if (this.videoRequested && video !== null) {
      try {
        if (retainVideo) {
          const file = path.join(this.artifactDirectory, "recording.webm");
          await video.saveAs(file);
          this.captured = [...this.captured, { kind: "video", path: file }];
        } else {
          await video.delete();
        }
      } catch (cause) {
        this.logger.errorFrom(cause, "Video finalisation failed.", {
          scenarioId: this.scenarioId,
        });
      }
    }

    // A passing scenario should leave no directory behind.
    if (!retainTrace && !retainVideo && this.captured.length === 0) {
      await rm(this.artifactDirectory, { recursive: true, force: true }).catch(() => undefined);
    }

    this.eventBus?.emit("browser.context.closed", {
      browserName: this.config.browser.name,
      ...(this.captured.length > 0
        ? { artifactPath: this.captured.map((a) => a.path).join(", ") }
        : {}),
    });

    return { artifacts: this.captured };
  }

  /** Matches the DI `Disposable` shape so the scenario scope tears this down. */
  async dispose(): Promise<void> {
    await this.close();
  }
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
}
