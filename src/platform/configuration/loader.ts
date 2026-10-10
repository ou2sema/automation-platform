import path from "node:path";
import process from "node:process";

import { ConfigurationError } from "../errors/index.js";
import { readEnvironment, type EnvSource } from "./env.js";
import {
  AI_PROVIDERS,
  ARTIFACT_MODES,
  BROWSER_NAMES,
  configurationSchema,
  LOG_LEVELS,
  RECOVERY_MODES,
  type PlatformConfiguration,
} from "./schema.js";

/**
 * Capability registry.
 *
 * A configuration flag is not a feature. Requesting a capability whose engine does
 * not exist yet is a hard configuration error rather than a silently-ignored flag,
 * which keeps "do not create fake integrations" mechanically enforced.
 *
 * Flip these to `true` in the phase that implements the engine.
 */
export const IMPLEMENTED_CAPABILITIES = {
  recoveryEngine: false, // Phase 4-5
  healingMemory: false, // Phase 6
  n8n: false, // Phase 8
  ai: false, // Phase 9
} as const;

const CAPABILITY_PHASE: Record<keyof typeof IMPLEMENTED_CAPABILITIES, string> = {
  recoveryEngine: "Phase 4 and Phase 5",
  healingMemory: "Phase 6",
  n8n: "Phase 8",
  ai: "Phase 9",
};

const BOOLEAN_TRUE = new Set(["true", "1", "yes", "on"]);
const BOOLEAN_FALSE = new Set(["false", "0", "no", "off"]);

export interface LoadOptions {
  readonly envSource?: EnvSource;
  readonly projectRoot?: string;
}

export function loadConfiguration(options: LoadOptions = {}): PlatformConfiguration {
  const source =
    options.envSource ??
    readEnvironment(options.projectRoot === undefined ? {} : { cwd: options.projectRoot });
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());

  const issues: string[] = [];
  const assembled = assemble(source, issues, projectRoot);

  if (issues.length > 0) {
    throw new ConfigurationError(
      `Invalid platform configuration (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n  - ${issues.join("\n  - ")}`,
      { context: { issues } },
    );
  }

  const parsed = configurationSchema.safeParse(assembled);
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    throw new ConfigurationError(
      `Platform configuration failed validation:\n  - ${details.join("\n  - ")}`,
      { context: { details } },
    );
  }

  enforceCapabilityGates(parsed.data);
  return parsed.data;
}

function assemble(
  source: EnvSource,
  issues: string[],
  projectRoot: string,
): Record<string, unknown> {
  const readChoice = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const raw = trimToUndefined(source[key]);
    if (raw === undefined) {
      return fallback;
    }
    const normalised = raw.toLowerCase() as T;
    if (!allowed.includes(normalised)) {
      issues.push(`${key} must be one of ${allowed.join(" | ")}, received "${raw}".`);
      return fallback;
    }
    return normalised;
  };

  const readBool = (key: string, fallback: boolean): boolean => {
    const raw = trimToUndefined(source[key]);
    if (raw === undefined) {
      return fallback;
    }
    const normalised = raw.toLowerCase();
    if (BOOLEAN_TRUE.has(normalised)) {
      return true;
    }
    if (BOOLEAN_FALSE.has(normalised)) {
      return false;
    }
    issues.push(`${key} must be a boolean (true/false/1/0/yes/no/on/off), received "${raw}".`);
    return fallback;
  };

  const readInt = (key: string, fallback: number): number => {
    const raw = trimToUndefined(source[key]);
    if (raw === undefined) {
      return fallback;
    }
    if (!/^-?\d+$/.test(raw)) {
      issues.push(`${key} must be an integer, received "${raw}".`);
      return fallback;
    }
    return Number.parseInt(raw, 10);
  };

  const readFloat = (key: string, fallback: number): number => {
    const raw = trimToUndefined(source[key]);
    if (raw === undefined) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      issues.push(`${key} must be a number, received "${raw}".`);
      return fallback;
    }
    return value;
  };

  const readString = (key: string, fallback: string): string => {
    const raw = trimToUndefined(source[key]);
    return raw ?? fallback;
  };

  const readAbsolute = (key: string, fallback: string): string =>
    path.resolve(projectRoot, readString(key, fallback));

  const readOptionalUrl = (key: string): string | undefined => {
    const raw = trimToUndefined(source[key]);
    if (raw === undefined) {
      return undefined;
    }
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        issues.push(`${key} must use the http or https scheme, received "${raw}".`);
        return undefined;
      }
    } catch {
      issues.push(`${key} must be an absolute URL, received "${raw}".`);
      return undefined;
    }
    return raw;
  };

  // Optional values are omitted entirely when unset rather than assigned undefined,
  // so that exactOptionalPropertyTypes stays satisfied through assembly.
  const baseUrl = readOptionalUrl("AP_TARGET_BASE_URL");
  const n8nBaseUrl = readOptionalUrl("AP_N8N_BASE_URL");
  const n8nWebhookToken = trimToUndefined(source.AP_N8N_WEBHOOK_TOKEN);
  const aiApiKey = trimToUndefined(source.AP_AI_API_KEY);

  return {
    projectRoot,
    run: {
      label: readString("AP_RUN_LABEL", "local"),
    },
    logging: {
      level: readChoice("AP_LOG_LEVEL", LOG_LEVELS, "info"),
      pretty: readBool("AP_LOG_PRETTY", false),
    },
    browser: {
      name: readChoice("AP_BROWSER", BROWSER_NAMES, "chromium"),
      headless: readBool("AP_HEADLESS", true),
      viewport: {
        width: readInt("AP_VIEWPORT_WIDTH", 1280),
        height: readInt("AP_VIEWPORT_HEIGHT", 720),
      },
      locale: readString("AP_LOCALE", "en-US"),
      timeouts: {
        actionMs: readInt("AP_DEFAULT_TIMEOUT_MS", 10_000),
        expectMs: readInt("AP_EXPECT_TIMEOUT_MS", 5_000),
        navigationMs: readInt("AP_NAVIGATION_TIMEOUT_MS", 15_000),
        closeMs: readInt("AP_BROWSER_CLOSE_TIMEOUT_MS", 15_000),
      },
      traceMode: readChoice("AP_TRACE_MODE", ARTIFACT_MODES, "retain-on-failure"),
      videoMode: readChoice("AP_VIDEO_MODE", ARTIFACT_MODES, "off"),
    },
    paths: {
      reportsDir: readAbsolute("AP_REPORTS_DIR", "reports"),
      artifactsDir: readAbsolute("AP_ARTIFACTS_DIR", "reports/artifacts"),
      fixturesDir: readAbsolute("AP_FIXTURES_DIR", "tests/fixtures"),
      healingDataDir: readAbsolute("AP_HEALING_MEMORY_DIR", "healing-data"),
    },
    application: {
      name: readString("AP_APPLICATION", "example-app"),
      ...(baseUrl === undefined ? {} : { baseUrl }),
    },
    recovery: {
      mode: readChoice("AP_RECOVERY_MODE", RECOVERY_MODES, "observe"),
      minConfidence: readFloat("AP_RECOVERY_MIN_CONFIDENCE", 0.85),
      maxAttemptsPerScenario: readInt("AP_RECOVERY_MAX_ATTEMPTS_PER_SCENARIO", 2),
    },
    healingMemory: {
      enabled: readBool("AP_HEALING_MEMORY_ENABLED", false),
    },
    integrations: {
      n8n: {
        enabled: readBool("AP_N8N_ENABLED", false),
        ...(n8nBaseUrl === undefined ? {} : { baseUrl: n8nBaseUrl }),
      },
      ai: {
        enabled: readBool("AP_AI_ENABLED", false),
        provider: readChoice("AP_AI_PROVIDER", AI_PROVIDERS, "none"),
        timeoutMs: readInt("AP_AI_TIMEOUT_MS", 15_000),
      },
    },
    secrets: {
      ...(n8nWebhookToken === undefined ? {} : { n8nWebhookToken }),
      ...(aiApiKey === undefined ? {} : { aiApiKey }),
    },
  };
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function enforceCapabilityGates(config: PlatformConfiguration): void {
  const requested: Partial<Record<keyof typeof IMPLEMENTED_CAPABILITIES, string>> = {};

  if (config.recovery.mode !== "observe") {
    requested.recoveryEngine = `AP_RECOVERY_MODE=${config.recovery.mode}`;
  }
  if (config.healingMemory.enabled) {
    requested.healingMemory = "AP_HEALING_MEMORY_ENABLED=true";
  }
  if (config.integrations.n8n.enabled) {
    requested.n8n = "AP_N8N_ENABLED=true";
  }
  if (config.integrations.ai.enabled || config.integrations.ai.provider !== "none") {
    requested.ai = `AP_AI_ENABLED=${String(config.integrations.ai.enabled)}, AP_AI_PROVIDER=${config.integrations.ai.provider}`;
  }

  const blocked = Object.entries(requested).filter(
    ([capability]) =>
      !IMPLEMENTED_CAPABILITIES[capability as keyof typeof IMPLEMENTED_CAPABILITIES],
  );

  if (blocked.length > 0) {
    const details = blocked
      .map(
        ([capability, flag]) =>
          `${flag} requires the ${capability} engine (${CAPABILITY_PHASE[capability as keyof typeof CAPABILITY_PHASE]}).`,
      )
      .join(" ");
    throw new ConfigurationError(
      `Configuration requests capabilities that are not implemented in this build. ${details} Leave the flags at their defaults, or implement the phase before enabling them.`,
      { context: { blocked: Object.fromEntries(blocked) } },
    );
  }

  if (
    IMPLEMENTED_CAPABILITIES.n8n &&
    config.integrations.n8n.enabled &&
    config.secrets.n8nWebhookToken === undefined
  ) {
    throw new ConfigurationError(
      "AP_N8N_ENABLED=true requires AP_N8N_WEBHOOK_TOKEN so incoming webhooks can be authenticated.",
    );
  }
}

/**
 * Redacted view of configuration, safe for logs and reports.
 */
export function describeConfiguration(config: PlatformConfiguration): Record<string, unknown> {
  return {
    projectRoot: config.projectRoot,
    run: { label: config.run.label },
    logging: { level: config.logging.level, pretty: config.logging.pretty },
    browser: {
      name: config.browser.name,
      headless: config.browser.headless,
      viewport: config.browser.viewport,
      locale: config.browser.locale,
      timeouts: config.browser.timeouts,
      traceMode: config.browser.traceMode,
      videoMode: config.browser.videoMode,
    },
    paths: config.paths,
    application: config.application,
    recovery: config.recovery,
    healingMemory: config.healingMemory,
    integrations: {
      n8n: { enabled: config.integrations.n8n.enabled },
      ai: { enabled: config.integrations.ai.enabled, provider: config.integrations.ai.provider },
    },
    secrets: {
      n8nWebhookToken: maskPresence(config.secrets.n8nWebhookToken),
      aiApiKey: maskPresence(config.secrets.aiApiKey),
    },
  };
}

function maskPresence(value: string | undefined): "set" | "unset" {
  return value === undefined ? "unset" : "set";
}
