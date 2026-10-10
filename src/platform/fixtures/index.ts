import { pathToFileURL } from "node:url";
import path from "node:path";

import type { PlatformConfiguration } from "../configuration/index.js";
import { PlatformError, PlatformErrorCode } from "../errors/index.js";

/**
 * Resolve a controlled fixture page to a `file:` URL.
 *
 * There is deliberately no web server: the deterministic fixture is read straight from
 * disk, which removes a whole class of environment failure from the gate. Path traversal
 * is rejected, because a route name ends up in a filesystem path here.
 */
export function resolveFixtureUrl(config: PlatformConfiguration, relativePath: string): string {
  const root = path.resolve(config.paths.fixturesDir);
  const absolute = path.resolve(root, relativePath);

  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new PlatformError(
      PlatformErrorCode.FIXTURE_NOT_FOUND,
      `Fixture "${relativePath}" resolves outside the fixtures root (${root}); traversal is rejected.`,
      { context: { relativePath, root, absolute } },
    );
  }

  return pathToFileURL(absolute).href;
}
