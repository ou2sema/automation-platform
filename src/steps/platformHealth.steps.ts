import { Given, Then, When } from "@cucumber/cucumber";

import { PlatformHealthJob } from "../jobs/platformHealthJob.js";
import type { PlatformHealthJobOutput } from "../jobs/platformHealthJob.js";
import type { PlatformWorld } from "../platform/cucumber/world.js";
import { AssertionFailedError } from "../platform/errors/index.js";

/**
 * Thin step definitions: each one either drives a Job or asserts on a Job result.
 * No selectors, no browser plumbing and no domain rules live here.
 */
const HEALTH_RESULT = "platformHealthResult";

Given<PlatformWorld>("a browser session for this scenario", async function () {
  await this.session();
});

When<PlatformWorld>("I open the platform health fixture", async function () {
  const job = new PlatformHealthJob(this);
  const output = await job.run({ fixturePath: "health-page/index.html" });
  this.remember(HEALTH_RESULT, output);
});

Then<PlatformWorld>("the page title is {string}", function (expected: string) {
  const result = this.recall<PlatformHealthJobOutput>(HEALTH_RESULT);
  if (result.title !== expected) {
    throw new AssertionFailedError(
      `Expected the fixture title to be "${expected}" but the browser reported "${result.title}".`,
      { context: { expected, actual: result.title, url: result.url } },
    );
  }
});

Then<PlatformWorld>("the fixture reports that browser script executed", function () {
  const result = this.recall<PlatformHealthJobOutput>(HEALTH_RESULT);
  // The fixture's own script rewrites this text, so the expected value proves the
  // page was rendered by a browser rather than read as static text.
  if (result.statusText !== "browser-executed") {
    throw new AssertionFailedError(
      `Expected the fixture status to read "browser-executed" but it read "${result.statusText}".`,
      { context: { actual: result.statusText, url: result.url } },
    );
  }
});

Then<PlatformWorld>("the page is at least interactive", function () {
  const result = this.recall<PlatformHealthJobOutput>(HEALTH_RESULT);
  if (result.readyState !== "interactive" && result.readyState !== "complete") {
    throw new AssertionFailedError(
      `Expected the document to be interactive or complete but it was "${result.readyState}".`,
      { context: { readyState: result.readyState } },
    );
  }
});

Then<PlatformWorld>("the scenario carries an isolated correlation identity", function () {
  const { runId, scenarioId } = this.correlation;
  if (runId.length === 0 || scenarioId === undefined || scenarioId.length === 0) {
    throw new AssertionFailedError(
      "The scenario is missing its run or scenario correlation identifier.",
      { context: { runId, scenarioId: scenarioId ?? null } },
    );
  }
  if (runId === scenarioId) {
    throw new AssertionFailedError("Scenario correlation must be distinct from run correlation.", {
      context: { runId },
    });
  }
  const stats = this.run.eventBus.stats();
  if (stats.emitted === 0) {
    throw new AssertionFailedError(
      "No platform events were emitted, so diagnostics cannot be correlated to this run.",
      { context: { stats } },
    );
  }
});
