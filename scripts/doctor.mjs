#!/usr/bin/env node
/**
 * Environment self-check for the automation platform.
 *
 * Answers "why can't this run on my machine?" before an engineer reads a Playwright
 * stack trace: Node version, pinned dependencies, browser executables, configuration
 * validity, writable artifact paths, and secret hygiene.
 *
 * Values of secret variables are never printed, only the variable names.
 */
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const checks = [];

function pass(name, detail) {
  checks.push({ status: "ok", name, detail });
}

function warn(name, detail) {
  checks.push({ status: "warn", name, detail });
}

function fail(name, detail, hint) {
  checks.push({ status: "fail", name, detail, hint });
}

function git(args) {
  return spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
}

const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));

// Node runtime.
{
  const declared = packageJson.engines?.node ?? ">=24";
  const requiredMajor = Number(/(\d+)/.exec(declared)?.[1] ?? 24);
  const actualMajor = Number(process.versions.node.split(".")[0]);
  if (actualMajor >= requiredMajor) {
    pass("node runtime", `${process.version} satisfies engines.node "${declared}"`);
  } else {
    fail("node runtime", `${process.version} is older than engines.node "${declared}".`);
  }
}

// Pinned dependencies.
{
  const wanted = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (!existsSync(path.join(projectRoot, "node_modules"))) {
    fail("dependencies", "node_modules is missing.", "Run 'npm ci'.");
  } else {
    const problems = [];
    for (const [name, pin] of Object.entries(wanted)) {
      const manifest = path.join(projectRoot, "node_modules", name, "package.json");
      if (!existsSync(manifest)) {
        problems.push(`${name}: not installed`);
        continue;
      }
      const { version } = JSON.parse(readFileSync(manifest, "utf8"));
      if (version !== pin) {
        problems.push(`${name}: installed ${version}, pinned ${pin}`);
      }
    }
    if (problems.length === 0) {
      pass("dependencies", `${Object.keys(wanted).length} packages match the pins in package.json`);
    } else {
      fail("dependencies", problems.join("; "), "Run 'npm ci' to restore the lockfile exactly.");
    }
  }
}

// Playwright browser executables.
{
  try {
    const { chromium } = await import("playwright");
    const executable = chromium.executablePath();
    if (existsSync(executable)) {
      pass("playwright browser", `${path.basename(path.dirname(executable))} is installed`);
    } else {
      fail(
        "playwright browser",
        `Chromium executable is missing at ${executable}.`,
        "Run 'npm run install:browsers'.",
      );
    }
  } catch (cause) {
    fail("playwright browser", `Cannot resolve the Chromium path: ${String(cause)}`);
  }
}

// Configuration loads under the current environment.
{
  // `node -e` evaluates as CommonJS, so the module graph is entered through an
  // async IIFE rather than a top-level await.
  const probe =
    "(async () => {" +
    'const { loadConfiguration, IMPLEMENTED_CAPABILITIES } = await import("./src/index.ts");' +
    "const config = loadConfiguration({});" +
    "process.stdout.write(JSON.stringify({" +
    "application: config.application.name," +
    "browser: config.browser.name," +
    "headless: config.browser.headless," +
    "recoveryMode: config.recovery.mode," +
    "capabilities: IMPLEMENTED_CAPABILITIES," +
    "}));" +
    "})().catch((cause) => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exit(1); });";

  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", probe], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  if (result.status === 0) {
    const summary = JSON.parse(result.stdout);
    const enabled = Object.entries(summary.capabilities)
      .filter(([, implemented]) => implemented)
      .map(([capability]) => capability);
    pass(
      "configuration",
      `${summary.application}/${summary.browser} headless=${summary.headless} ` +
        `recovery=${summary.recoveryMode} ` +
        `engines implemented: ${enabled.length === 0 ? "none (Phase 1)" : enabled.join(", ")}`,
    );
  } else {
    const message = (result.stderr || result.stdout || "unknown failure").trim().split("\n")[0];
    fail("configuration", message, "Fix the reported AP_* variable; see .env.example.");
  }
}

// Artifact directory is writable.
{
  const artifactsDir = path.join(projectRoot, "reports", "artifacts");
  const sentinel = path.join(artifactsDir, ".doctor-write");
  try {
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(sentinel, "written");
    accessSync(sentinel, constants.W_OK);
    rmSync(sentinel);
    pass("artifact directory", `${artifactsDir} is writable`);
  } catch (cause) {
    fail("artifact directory", `${artifactsDir} is not writable: ${String(cause)}`);
  }
}

// Secret hygiene.
{
  const tracked = git(["ls-files", "--", ".env", ".env.local"]);
  if (tracked.status === 0 && tracked.stdout.trim() !== "") {
    fail(
      "secret hygiene",
      `Environment file(s) are tracked by git: ${tracked.stdout.trim().replace(/\n/g, ", ")}.`,
      "Remove them from the index with 'git rm --cached <file>' before committing anything else.",
    );
  } else {
    pass("secret hygiene", "no .env file is tracked by git");
  }

  const example = path.join(projectRoot, ".env.example");
  if (!existsSync(example)) {
    fail(
      "secret hygiene",
      ".env.example is missing.",
      "Document every AP_* variable with an empty value.",
    );
  } else {
    const suspicious = readFileSync(example, "utf8")
      .split("\n")
      // The template documents each variable in a trailing comment; only the part
      // before it can carry a value.
      .map((line) => line.split("#")[0].trim())
      .filter((line) => /^[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*=\S/.test(line))
      .map((line) => line.split("=")[0]);
    if (suspicious.length === 0) {
      pass("env template", ".env.example assigns no values to secret variables");
    } else {
      warn(
        "env template",
        `.env.example has values set for ${suspicious.join(", ")}; keep them empty.`,
      );
    }
  }
}

const symbols = { ok: "[ ok ]", warn: "[warn]", fail: "[FAIL]" };
for (const check of checks) {
  console.log(`${symbols[check.status]} ${check.name.padEnd(20)} ${check.detail}`);
  if (check.hint !== undefined) {
    console.log(`        ${check.hint}`);
  }
}

const failures = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");
console.log(
  `\n${checks.length - failures.length - warnings.length}/${checks.length} checks passed, ` +
    `${warnings.length} warning(s), ${failures.length} failure(s).`,
);

process.exit(failures.length > 0 ? 1 : 0);
