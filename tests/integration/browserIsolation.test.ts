import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BrowserManager,
  BrowserSession,
  isPlatformError,
  PlatformErrorCode,
  type CorrelationIds,
  type PlatformConfiguration,
} from "../../src/index.js";
import { resolveFixtureUrl } from "../../src/platform/fixtures/index.js";

import { makeConfiguration } from "../unit/helpers/configuration.js";
import { makeTestLogger } from "../unit/helpers/logger.js";

interface PageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A scenario that passed should leave no artifact directory behind. */
async function closePassed(session: BrowserSession): Promise<void> {
  session.recordStatus("passed");
  await session.close();
}

/**
 * Phase 1 gate evidence: the platform shares one browser *process* per run and one
 * `BrowserContext` per scenario, and a scenario can leave state in its own context
 * without any of it reaching the next one.
 */
describe("browser session isolation", () => {
  let artifactsRoot = "";
  let config: PlatformConfiguration;
  let manager: BrowserManager;

  beforeAll(async () => {
    artifactsRoot = await mkdtemp(path.join(tmpdir(), "automation-platform-isolation-"));
  });

  afterAll(async () => {
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    config = makeConfiguration({
      AP_ARTIFACTS_DIR: artifactsRoot,
      AP_TRACE_MODE: "retain-on-failure",
      AP_VIDEO_MODE: "off",
    });
    manager = new BrowserManager({ config, logger: makeTestLogger().logger });
  });

  afterEach(async () => {
    await manager.close();
  });

  async function openSession(scenarioId: string): Promise<BrowserSession> {
    const browser = await manager.acquire();
    const correlation: CorrelationIds = { runId: "run-isolation", scenarioId };
    const session = await BrowserSession.create({
      browser,
      config,
      logger: makeTestLogger().logger,
      correlation,
    });
    await session.page.goto(resolveFixtureUrl(config, "health-page/index.html"));
    return session;
  }

  it("gives concurrent scenarios their own context and page", async () => {
    const [first, second] = await Promise.all([
      openSession("scenario-a"),
      openSession("scenario-b"),
    ]);

    expect(first.context).not.toBe(second.context);
    expect(first.page).not.toBe(second.page);
    expect(first.context.pages()).toEqual([first.page]);
    expect(second.context.pages()).toEqual([second.page]);

    await closePassed(first);
    await closePassed(second);
  });
  it("keeps cookies written by one scenario out of the next", async () => {
    const writer = await openSession("cookie-writer");
    await writer.context.addCookies([
      { name: "session-token", value: "scenario-scoped", domain: "isolated.test", path: "/" },
    ]);
    expect((await writer.context.cookies()).map((cookie) => cookie.name)).toContain(
      "session-token",
    );

    const reader = await openSession("cookie-reader");
    expect(await reader.context.cookies()).toEqual([]);

    await closePassed(writer);
    await closePassed(reader);
  });

  it("scopes page storage to the context that wrote it", async () => {
    const writer = await openSession("storage-writer");
    await writer.page.evaluate(() => {
      const storage = (globalThis as unknown as { localStorage: PageStorage }).localStorage;
      storage.setItem("isolated-key", "written-by-writer");
    });

    const readBack = await writer.page.evaluate(() => {
      const storage = (globalThis as unknown as { localStorage: PageStorage }).localStorage;
      return storage.getItem("isolated-key");
    });
    expect(readBack).toBe("written-by-writer");

    const other = await openSession("storage-reader");
    const seenByOther = await other.page.evaluate(() => {
      const storage = (globalThis as unknown as { localStorage: PageStorage }).localStorage;
      return storage.getItem("isolated-key");
    });
    expect(seenByOther).toBeNull();

    await closePassed(writer);
    await closePassed(other);
  });

  it("reuses one browser process for the whole run", async () => {
    const launched = await manager.acquire();
    const again = await manager.acquire();
    const concurrent = await Promise.all([manager.acquire(), manager.acquire()]);

    expect(again).toBe(launched);
    expect(concurrent[0]).toBe(launched);
    expect(concurrent[1]).toBe(launched);
    expect(manager.isLaunched).toBe(true);
    expect(manager.version).toMatch(/^\d+\./);
  });

  it("keeps diagnostics for a scenario that did not pass, and discards them otherwise", async () => {
    const passed = await openSession("outcome-passed");
    passed.recordStatus("passed");
    const passedResult = await passed.close();

    expect(passedResult.artifacts).toEqual([]);
    expect(existsSync(passed.directory)).toBe(false);

    const failed = await openSession("outcome-failed");
    failed.recordStatus("failed");
    const failedResult = await failed.close();

    const trace = failedResult.artifacts.find((artifact) => artifact.kind === "trace");
    expect(trace).toBeDefined();
    expect(existsSync(trace?.path ?? "")).toBe(true);
    expect(failed.directory).not.toBe(passed.directory);
  });

  it("refuses to hand out a browser once the run has closed it", async () => {
    await manager.acquire();
    await manager.close();

    const failure = await manager.acquire().catch((cause: unknown) => cause);
    expect(isPlatformError(failure) && failure.code).toBe(PlatformErrorCode.BROWSER_NOT_AVAILABLE);
  });
});
