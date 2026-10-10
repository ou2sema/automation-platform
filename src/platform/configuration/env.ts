import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse as parseDotenv } from "dotenv";

const ENV_PREFIX = "AP_";

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Load platform configuration input.
 *
 * `.env` is read as an isolated record and never written into `process.env`, so
 * importing this module cannot leak configuration into unrelated globals.
 *
 * Precedence defaults to process environment over file, because CI and container
 * runtimes inject config and their values must win over a stale local file.
 */
export function readEnvironment(
  options: {
    readonly cwd?: string;
    readonly file?: string;
    readonly fileOverridesProcessEnv?: boolean;
  } = {},
): EnvSource {
  const cwd = options.cwd ?? process.cwd();
  const filePath = options.file ?? path.join(cwd, ".env");
  const fileOverrides = options.fileOverridesProcessEnv ?? false;

  const fileValues: Record<string, string | undefined> = existsSync(filePath)
    ? onlyPlatformKeys(parseDotenv(readFileSync(filePath)))
    : {};
  const processValues = onlyPlatformKeys(process.env);

  return fileOverrides ? { ...processValues, ...fileValues } : { ...fileValues, ...processValues };
}

export function onlyPlatformKeys(source: EnvSource): EnvSource {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && key.startsWith(ENV_PREFIX)) {
      result[key] = value;
    }
  }
  return result;
}
