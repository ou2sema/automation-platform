import {
  After,
  AfterAll,
  Before,
  BeforeAll,
  setDefaultTimeout,
  setWorldConstructor,
} from "@cucumber/cucumber";
import type { ITestCaseHookParameter } from "@cucumber/cucumber";

import { PlatformWorld } from "../platform/cucumber/world.js";
import type { ScenarioResultStatus } from "../platform/events/types.js";
import { toErrorReport } from "../platform/errors/index.js";
import { initializeRun, shutdownRun } from "../platform/runtime/runContext.js";

setWorldConstructor(PlatformWorld);

/**
 * Run lifecycle.
 *
 * `BeforeAll`/`AfterAll` execute once per Cucumber worker process, which is exactly
 * the run scope the composition root assumes. Keeping the browser process shared and
 * the contexts per-scenario is what makes isolation cheap instead of slow.
 */
BeforeAll(function (): void {
  const run = initializeRun();

  /**
   * Cucumber's 5 s default is a step timeout, not an interaction timeout, and using it
   * meant a slow step reported "function timed out" instead of the platform's own error
   * naming the page, the locator and the budget that ran out. The backstop is set above
   * the sum of the inner Playwright timeouts so those always fire first with context.
   */
  setDefaultTimeout(run.config.browser.timeouts.navigationMs * 4);
});

AfterAll(async function (): Promise<void> {
  await shutdownRun({ outcome: "completed" });
});

Before<PlatformWorld>(function (parameter: ITestCaseHookParameter): void {
  this.configureScenario(parameter);
  this.logger.debug("Scenario starting.", {
    uri: parameter.pickle.uri,
    tags: parameter.pickle.tags.map((tag) => tag.name),
  });
});

/**
 * Scenario teardown.
 *
 * Unknown status is treated as a failure for artifact purposes: when the platform
 * cannot prove the scenario passed, it keeps the evidence instead of discarding it.
 */
After<PlatformWorld>({ timeout: 120_000 }, async function (parameter) {
  const status = mapStatus(parameter.result?.status);

  if (status === "failed") {
    const error: unknown = parameter.error;
    if (error !== undefined && error !== null) {
      this.run.eventBus.emit(
        "failure.recorded",
        { scenarioName: this.name, report: toErrorReport(error) },
        this.correlation,
      );
    }
  }

  await this.finish(status);
});

function mapStatus(raw: string | undefined): ScenarioResultStatus {
  switch (raw) {
    case "PASSED":
      return "passed";
    case "FAILED":
      return "failed";
    case "SKIPPED":
      return "skipped";
    case "UNDEFINED":
      return "undefined";
    case "PENDING":
      return "pending";
    case "AMBIGUOUS":
      return "ambiguous";
    default:
      // UNKNOWN or absent: retain artifacts, report as failed.
      return "failed";
  }
}
