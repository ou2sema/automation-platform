import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isPlatformError, PlatformErrorCode, type PlatformError } from "../../src/index.js";
import { resolveFixtureUrl } from "../../src/platform/fixtures/index.js";

import { makeConfiguration } from "./helpers/configuration.js";

function captureFixtureError(operation: () => string): PlatformError {
  try {
    const url = operation();
    throw new Error(`Expected the fixture guard to reject, but it resolved to: ${url}`);
  } catch (cause) {
    if (isPlatformError(cause)) {
      return cause;
    }
    throw cause;
  }
}

describe("resolveFixtureUrl", () => {
  const config = makeConfiguration();
  const root = path.resolve(config.paths.fixturesDir);

  it("builds a file: URL for a page inside the fixtures root", () => {
    const url = resolveFixtureUrl(config, "health-page/index.html");

    expect(url).toBe(pathToFileURL(path.join(root, "health-page", "index.html")).href);
    expect(url.startsWith("file:")).toBe(true);
  });

  it("resolves the fixtures root itself", () => {
    expect(resolveFixtureUrl(config, ".")).toBe(pathToFileURL(root).href);
  });

  it("resolves the shipped health fixture to a file that exists", () => {
    const url = resolveFixtureUrl(config, "health-page/index.html");

    expect(existsSync(fileURLToPath(url))).toBe(true);
  });

  it("rejects a path that climbs out of the fixtures root", () => {
    const failure = captureFixtureError(() => resolveFixtureUrl(config, "../../package.json"));

    expect(failure.code).toBe(PlatformErrorCode.FIXTURE_NOT_FOUND);
    expect(failure.message).toContain("traversal is rejected");
  });

  it("rejects an absolute path outside the fixtures root", () => {
    const outside = path.resolve(path.parse(root).root, "outside-fixture-root.html");
    const failure = captureFixtureError(() => resolveFixtureUrl(config, outside));

    expect(failure.code).toBe(PlatformErrorCode.FIXTURE_NOT_FOUND);
    expect(failure.context.relativePath).toBe(outside);
  });

  it("rejects a sibling directory whose name merely starts with the root", () => {
    const neighbour = `${root}-neighbour/index.html`;
    const failure = captureFixtureError(() => resolveFixtureUrl(config, neighbour));

    expect(failure.code).toBe(PlatformErrorCode.FIXTURE_NOT_FOUND);
  });
});
