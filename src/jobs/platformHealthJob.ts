import { existsSync } from "node:fs";

import { PlatformError, PlatformErrorCode } from "../platform/errors/index.js";
import type { ExecutionContext } from "../platform/contracts.js";
import { createId, runWithin } from "../platform/observability/correlation.js";
import { resolveFixtureUrl } from "../platform/fixtures/index.js";
import { HealthPage } from "../applications/health/pages/healthPage.js";

export interface PlatformHealthJobInput {
  readonly fixturePath: string;
}

export interface PlatformHealthJobOutput {
  readonly title: string;
  readonly url: string;
  readonly readyState: string;
  readonly statusText: string;
}

/**
 * First vertical slice: Feature -> Step -> Job -> Page Object -> Playwright.
 *
 * Deliberately small, but it crosses every layer, so a weakness anywhere in the
 * foundation surfaces as a Phase 1 gate failure instead of hiding until Phase 2.
 *
 * It reads the fixture through a Page Object rather than going through a Service,
 * because there is no business decision to make here: the page either reports that
 * JavaScript ran in a real browser or it does not.
 */
export class PlatformHealthJob {
  private readonly context: ExecutionContext;

  constructor(context: ExecutionContext) {
    this.context = context;
  }

  async run(input: PlatformHealthJobInput): Promise<PlatformHealthJobOutput> {
    // The job boundary introduces jobId into the correlation chain. It is seeded
    // from the scenario correlation the context carries, so every log and event
    // below resolves as runId -> scenarioId -> jobId.
    return runWithin(this.context.correlation, { jobId: createId("job") }, async () => {
      const { logger, config } = this.context;
      const url = resolveFixtureUrl(config, input.fixturePath);

      if (!existsSync(new URL(url))) {
        throw new PlatformError(
          PlatformErrorCode.FIXTURE_NOT_FOUND,
          `Health fixture is missing at ${url}. The Phase 1 slice requires tests/fixtures/health-page/index.html.`,
          { context: { fixturePath: input.fixturePath, url } },
        );
      }

      logger.debug("Opening health fixture.", { fixturePath: input.fixturePath });

      const health = new HealthPage(
        await this.context.page(),
        config.browser.timeouts.navigationMs,
      );
      await health.open(url);

      const title = await health.title();
      const readyState = await health.readyState();
      const statusText = await health.statusText();

      logger.info("Health fixture reached.", { title, readyState });

      return { title, url, readyState, statusText };
    });
  }
}
