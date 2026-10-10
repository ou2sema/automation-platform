import { z } from "zod";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export const BROWSER_NAMES = ["chromium", "firefox", "webkit"] as const;
export const ARTIFACT_MODES = ["off", "on", "retain-on-failure"] as const;
export const RECOVERY_MODES = ["observe", "suggest", "auto"] as const;
export const AI_PROVIDERS = ["none", "openai", "anthropic", "local"] as const;

/**
 * Structural contract for assembled configuration.
 *
 * Primitive conversion from strings happens in `loader.ts` so that diagnostics can
 * name the offending `AP_*` variable. This schema is the single source of truth for
 * the resulting type and for value ranges.
 */
export const configurationSchema = z.strictObject({
  projectRoot: z.string().min(1),
  run: z.strictObject({
    label: z.string().min(1).max(64),
  }),
  logging: z.strictObject({
    level: z.enum(LOG_LEVELS),
    pretty: z.boolean(),
  }),
  browser: z.strictObject({
    name: z.enum(BROWSER_NAMES),
    headless: z.boolean(),
    viewport: z.strictObject({
      width: z.number().int().min(320).max(7680),
      height: z.number().int().min(240).max(4320),
    }),
    locale: z.string().min(2).max(35),
    timeouts: z.strictObject({
      actionMs: z.number().int().min(100).max(600_000),
      expectMs: z.number().int().min(100).max(600_000),
      navigationMs: z.number().int().min(100).max(600_000),
      closeMs: z.number().int().min(100).max(120_000),
    }),
    traceMode: z.enum(ARTIFACT_MODES),
    videoMode: z.enum(ARTIFACT_MODES),
  }),
  paths: z.strictObject({
    reportsDir: z.string().min(1),
    artifactsDir: z.string().min(1),
    fixturesDir: z.string().min(1),
    healingDataDir: z.string().min(1),
  }),
  application: z.strictObject({
    name: z.string().min(1),
    baseUrl: z.string().optional(),
  }),
  recovery: z.strictObject({
    mode: z.enum(RECOVERY_MODES),
    minConfidence: z.number().min(0).max(1),
    maxAttemptsPerScenario: z.number().int().min(1).max(10),
  }),
  healingMemory: z.strictObject({
    enabled: z.boolean(),
  }),
  integrations: z.strictObject({
    n8n: z.strictObject({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
    }),
    ai: z.strictObject({
      enabled: z.boolean(),
      provider: z.enum(AI_PROVIDERS),
      timeoutMs: z.number().int().min(100).max(120_000),
    }),
  }),
  /**
   * Secrets live in one node so redaction has exactly one place to guard.
   * Nothing here may be logged, written to reports, or sent to n8n.
   */
  secrets: z.strictObject({
    n8nWebhookToken: z.string().min(1).optional(),
    aiApiKey: z.string().min(1).optional(),
  }),
});

export type PlatformConfiguration = z.output<typeof configurationSchema>;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type BrowserName = (typeof BROWSER_NAMES)[number];
export type ArtifactMode = (typeof ARTIFACT_MODES)[number];
export type RecoveryMode = (typeof RECOVERY_MODES)[number];

/**
 * Configuration paths that must never appear in log output or event payloads.
 */
export const SENSITIVE_CONFIG_PATHS = [
  "secrets.n8nWebhookToken",
  "secrets.aiApiKey",
  "secrets.*",
] as const;
