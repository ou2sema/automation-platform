import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigurationError, describeConfiguration, readEnvironment } from "../../src/index.js";
import { makeConfiguration } from "./helpers/configuration.js";

describe("configuration: defaults", () => {
  it("produces a fully typed configuration from an empty environment", () => {
    const config = makeConfiguration({ AP_RUN_LABEL: undefined });

    expect(config.run.label).toBe("local");
    expect(config.browser.name).toBe("chromium");
    expect(config.browser.headless).toBe(true);
    expect(config.browser.timeouts.actionMs).toBe(10_000);
    expect(config.recovery.mode).toBe("observe");
    expect(config.healingMemory.enabled).toBe(false);
    expect(config.integrations.n8n.enabled).toBe(false);
    expect(config.integrations.ai.enabled).toBe(false);
  });

  it("resolves paths against the project root so behaviour is cwd-independent", () => {
    const config = makeConfiguration({ AP_ARTIFACTS_DIR: "reports/artifacts" });

    expect(config.paths.artifactsDir).toMatch(/reports[\\/]artifacts$/);
    expect(config.paths.artifactsDir.startsWith(config.projectRoot)).toBe(true);
  });

  it("omits optional values rather than storing undefined", () => {
    const config = makeConfiguration({ AP_TARGET_BASE_URL: "   " });

    expect("baseUrl" in config.application).toBe(false);
  });
});

describe("configuration: primitive conversion", () => {
  it("accepts the documented boolean spellings", () => {
    for (const value of ["true", "1", "yes", "on"]) {
      expect(makeConfiguration({ AP_HEADLESS: value }).browser.headless).toBe(true);
    }
    for (const value of ["false", "0", "no", "off"]) {
      expect(makeConfiguration({ AP_HEADLESS: value }).browser.headless).toBe(false);
    }
  });

  it("is case-insensitive for enums and booleans", () => {
    expect(makeConfiguration({ AP_BROWSER: "CHROMIUM" }).browser.name).toBe("chromium");
    expect(makeConfiguration({ AP_HEADLESS: "False" }).browser.headless).toBe(false);
  });

  it("reports every problem in one error instead of failing on the first", () => {
    const failure = (() => {
      try {
        makeConfiguration({ AP_DEFAULT_TIMEOUT_MS: "soon", AP_HEADLESS: "maybe" });
        return undefined;
      } catch (cause) {
        return cause;
      }
    })();

    expect(failure).toBeInstanceOf(ConfigurationError);
    const message = (failure as Error).message;
    expect(message).toContain("AP_DEFAULT_TIMEOUT_MS");
    expect(message).toContain("AP_HEADLESS");
    expect(message).toContain("2 issues");
  });

  it("rejects a non-integer timeout naming the received value", () => {
    expect(() => makeConfiguration({ AP_VIEWPORT_WIDTH: "12.5" })).toThrow(
      /AP_VIEWPORT_WIDTH must be an integer, received "12\.5"/,
    );
  });

  it("rejects an unknown browser instead of silently falling back", () => {
    expect(() => makeConfiguration({ AP_BROWSER: "edge" })).toThrow(/AP_BROWSER must be one of/);
  });
});

describe("configuration: URL validation", () => {
  it("accepts an https base URL", () => {
    const config = makeConfiguration({ AP_TARGET_BASE_URL: "https://app.example.test/" });
    expect(config.application.baseUrl).toBe("https://app.example.test/");
  });

  it("rejects a relative base URL", () => {
    expect(() => makeConfiguration({ AP_TARGET_BASE_URL: "app.example.test" })).toThrow(
      /AP_TARGET_BASE_URL must be an absolute URL/,
    );
  });

  it("rejects a non-http scheme so credentials cannot leak over plaintext", () => {
    expect(() => makeConfiguration({ AP_TARGET_BASE_URL: "ftp://app.example.test" })).toThrow(
      /must use the http or https scheme/,
    );
  });

  it("rejects a file: URL for the n8n base so webhook tokens are never sent to disk paths", () => {
    expect(() => makeConfiguration({ AP_N8N_BASE_URL: "file:///C:/tmp" })).toThrow(
      /AP_N8N_BASE_URL/,
    );
  });
});

describe("configuration: range enforcement", () => {
  it("rejects a confidence outside 0..1", () => {
    expect(() => makeConfiguration({ AP_RECOVERY_MIN_CONFIDENCE: "1.4" })).toThrow(
      ConfigurationError,
    );
  });

  it("rejects an absurdly large close timeout", () => {
    expect(() => makeConfiguration({ AP_BROWSER_CLOSE_TIMEOUT_MS: "999999" })).toThrow(
      ConfigurationError,
    );
  });
});

describe("configuration: capability gates", () => {
  it("refuses recoveryMode=suggest because the Recovery Engine does not exist yet", () => {
    expect(() => makeConfiguration({ AP_RECOVERY_MODE: "suggest" })).toThrow(
      /recoveryEngine engine \(Phase 4 and Phase 5\)/,
    );
  });

  it("refuses to enable healing memory before Phase 6", () => {
    expect(() => makeConfiguration({ AP_HEALING_MEMORY_ENABLED: "true" })).toThrow(
      /healingMemory engine \(Phase 6\)/,
    );
  });

  it("refuses to enable n8n before Phase 8", () => {
    expect(() => makeConfiguration({ AP_N8N_ENABLED: "true" })).toThrow(/n8n engine \(Phase 8\)/);
  });

  it("refuses an AI provider even when the enabled flag is left off", () => {
    expect(() => makeConfiguration({ AP_AI_PROVIDER: "openai" })).toThrow(/ai engine \(Phase 9\)/);
  });

  it("keeps observe mode and disabled integrations working", () => {
    expect(() =>
      makeConfiguration({ AP_RECOVERY_MODE: "observe", AP_N8N_ENABLED: "false" }),
    ).not.toThrow();
  });
});

describe("configuration: secret safety", () => {
  it("never exposes secret values in the loggable view", () => {
    const config = makeConfiguration({ AP_AI_API_KEY: "sk-super-secret-value" });
    expect(config.secrets.aiApiKey).toBe("sk-super-secret-value");

    const summary = describeConfiguration(config);
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain("sk-super-secret-value");
    expect(serialised).toContain('"aiApiKey":"set"');
  });

  it("distinguishes unset secrets from empty ones", () => {
    const summary = describeConfiguration(makeConfiguration());
    expect((summary.secrets as Record<string, string>).n8nWebhookToken).toBe("unset");
  });
});

describe("configuration: environment precedence", () => {
  const temporaryFile = (contents: string): string => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "ap-config-"));
    const file = path.join(directory, ".env");
    writeFileSync(file, contents, "utf8");
    return file;
  };

  it("keeps only AP_ prefixed variables", () => {
    const file = temporaryFile("AP_RUN_LABEL=from-file\nPATH=should-be-ignored\n");
    const source = readEnvironment({ file });

    expect(Object.keys(source)).toEqual(["AP_RUN_LABEL"]);
    expect(source.AP_RUN_LABEL).toBe("from-file");
  });

  it("prefers the process environment over the file by default", () => {
    const file = temporaryFile("AP_RUN_LABEL=from-file\n");
    process.env.AP_RUN_LABEL = "from-process";
    try {
      const source = readEnvironment({ file });
      expect(source.AP_RUN_LABEL).toBe("from-process");
    } finally {
      delete process.env.AP_RUN_LABEL;
    }
  });

  it("lets the file win only when explicitly asked to override", () => {
    const file = temporaryFile("AP_RUN_LABEL=from-file\n");
    process.env.AP_RUN_LABEL = "from-process";
    try {
      const source = readEnvironment({ file, fileOverridesProcessEnv: true });
      expect(source.AP_RUN_LABEL).toBe("from-file");
    } finally {
      delete process.env.AP_RUN_LABEL;
    }
  });

  it("does not mutate process.env while loading", () => {
    const before = process.env.AP_RUN_LABEL;
    const file = temporaryFile("AP_RUN_LABEL=should-not-leak\n");
    readEnvironment({ file });
    expect(process.env.AP_RUN_LABEL).toBe(before);
  });
});
