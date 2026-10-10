import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Mechanical layer boundaries.
 *
 * `eslint.config.js` restricts imports too, but a linter rule is only as durable as its
 * configuration: a pattern that silently stops matching (one in this repository's first
 * draft did) removes the boundary while leaving the green tick. This file re-states the
 * same boundaries by resolving every import to a real project path, so `../../platform/x`
 * and `../domains/../platform/x` are treated identically, and it additionally checks which
 * files may name a locator at all.
 *
 * The scanning functions are pure over (path, source text) so this file can test the
 * scanner itself. Without those tests, "no violations" could mean "nothing was examined".
 */

const PROJECT_ROOT = process.cwd();
const SOURCE_ROOT = "src";

interface RawImport {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly line: number;
}

interface ImportedModule extends RawImport {
  /**
   * Project-relative, extension-free path for relative specifiers; `undefined` for
   * packages and Node builtins, which are matched by name instead.
   */
  readonly resolved: string | undefined;
}

interface BoundaryRule {
  readonly name: string;
  readonly appliesTo: (relativePath: string) => boolean;
  /** Bare specifiers, matched exactly or as a scope (`@cucumber` rejects `@cucumber/*`). */
  readonly forbiddenPackages: readonly string[];
  /** Path prefixes such as `src/platform`, or double-star markers for a named directory. */
  readonly forbiddenPaths: readonly string[];
  /**
   * Whether `import type` is tolerated. The domain rule uses `false`: a type import
   * leaves no runtime edge, but it lets a UI concept into the vocabulary of a business
   * rule, and that is how layers get merged back together.
   */
  readonly allowTypeImports: boolean;
}

interface Violation {
  readonly file: string;
  readonly rule: string;
  readonly specifier: string;
  readonly line: number;
}

/**
 * The API that names, drives or inspects the browser. Page objects own it, because a
 * Service that reaches for it directly has quietly become a Page Object.
 */
const LOCATOR_PRIMITIVES = [
  ".locator(",
  ".getByTestId(",
  ".getByRole(",
  ".getByText(",
  ".getByLabel(",
  ".getByPlaceholder(",
  ".getByAltText(",
  ".goto(",
  ".click(",
  ".fill(",
  ".press(",
  ".check(",
  ".selectOption(",
  ".textContent(",
  ".innerText(",
  ".getAttribute(",
  ".inputValue(",
  ".waitFor(",
  ".screenshot(",
  ".evaluate(",
  ".url(",
] as const;

/**
 * Statements are anchored to a line start so that the word `import` inside prose,
 * a string or a doc comment is not read as a dependency.
 */
const STATIC_IMPORT =
  /(?:^|\n)[ \t]*(?:import|export)([^;'"]{0,600}?)\bfrom[ \t]*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)[ \t]*import[ \t]+["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport[ \t]*\([ \t]*["']([^"']+)["'][ \t]*\)/g;

function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type")) {
    return true;
  }

  const inner = /\{([^}]*)\}/.exec(trimmed)?.[1];
  if (inner === undefined) {
    return false;
  }

  // `import { type Page, chromium }` still binds a value, so only an all-type list counts.
  const outsideBraces = trimmed
    .replace(/\{[^}]*\}/, "")
    .replace(/,/g, "")
    .trim();
  if (outsideBraces.length > 0) {
    return false;
  }

  const bindings = inner
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return bindings.length > 0 && bindings.every((token) => token.startsWith("type "));
}

function collect(
  pattern: RegExp,
  source: string,
  typeOnly: (clause: string) => boolean,
): RawImport[] {
  const found: RawImport[] = [];
  pattern.lastIndex = 0;

  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const specifier = match[match.length - 1];
    if (specifier === undefined) {
      continue;
    }
    const clause = match.length > 2 ? (match[1] ?? "") : "";
    found.push({
      specifier,
      typeOnly: typeOnly(clause),
      line: source.slice(0, match.index).split("\n").length,
    });
  }

  return found;
}

export function importsOf(relativePath: string, source: string): readonly ImportedModule[] {
  const directory = path.posix.dirname(relativePath);
  const raw = [
    ...collect(STATIC_IMPORT, source, isTypeOnlyClause),
    ...collect(SIDE_EFFECT_IMPORT, source, () => false),
    ...collect(DYNAMIC_IMPORT, source, () => false),
  ].sort((left, right) => left.line - right.line);

  return raw.map((item) => ({
    ...item,
    resolved: item.specifier.startsWith(".")
      ? path.posix.normalize(path.posix.join(directory, item.specifier)).replace(/\.js$/, "")
      : undefined,
  }));
}

function matchesForbiddenPath(resolved: string, target: string): boolean {
  if (target.startsWith("**/")) {
    return `/${resolved}/`.includes(`/${target.slice(3)}/`);
  }
  return resolved === target || resolved.startsWith(`${target}/`);
}

export function findBoundaryViolations(
  relativePath: string,
  source: string,
  rules: readonly BoundaryRule[],
): readonly Violation[] {
  const violations: Violation[] = [];

  for (const item of importsOf(relativePath, source)) {
    for (const rule of rules) {
      if (!rule.appliesTo(relativePath) || (item.typeOnly && rule.allowTypeImports)) {
        continue;
      }

      const packageHit = rule.forbiddenPackages.find(
        (name) => item.specifier === name || item.specifier.startsWith(`${name}/`),
      );
      const resolved = item.resolved;
      const pathHit =
        resolved === undefined
          ? undefined
          : rule.forbiddenPaths.find((target) => matchesForbiddenPath(resolved, target));

      if (packageHit !== undefined || pathHit !== undefined) {
        violations.push({
          file: relativePath,
          rule: rule.name,
          specifier: item.specifier,
          line: item.line,
        });
      }
    }
  }

  return violations;
}

export function findLocatorViolations(relativePath: string, source: string): readonly string[] {
  const guarded =
    relativePath.startsWith("src/steps/") ||
    relativePath.startsWith("src/jobs/") ||
    relativePath.startsWith("src/domains/") ||
    `/${relativePath}/`.includes("/services/");

  if (!guarded) {
    return [];
  }

  return LOCATOR_PRIMITIVES.filter((primitive) => source.includes(primitive));
}

export const BOUNDARY_RULES: readonly BoundaryRule[] = [
  {
    name: "business rules must not know a browser, the runner or an adapter exists",
    appliesTo: (file) => file.startsWith("src/domains/"),
    forbiddenPackages: ["playwright", "@playwright", "@cucumber"],
    forbiddenPaths: ["src/platform", "src/applications", "src/jobs", "src/steps", "src/support"],
    allowTypeImports: false,
  },
  {
    name: "a Cucumber step must not contain locator logic or touch the driver",
    appliesTo: (file) => file.startsWith("src/steps/"),
    forbiddenPackages: ["playwright", "@playwright"],
    forbiddenPaths: ["**/pages", "src/platform/browser"],
    allowTypeImports: true,
  },
  {
    name: "a Page Object must not orchestrate a use case",
    appliesTo: (file) => `/${file}/`.includes("/pages/"),
    forbiddenPackages: [],
    forbiddenPaths: ["src/jobs", "src/steps", "**/services"],
    allowTypeImports: true,
  },
  {
    name: "a Page Object must not implement its own recovery, healing or AI engine",
    appliesTo: (file) => `/${file}/`.includes("/pages/"),
    forbiddenPackages: [],
    forbiddenPaths: ["**/recovery", "**/healing", "**/heuristics", "**/ai", "**/visual"],
    allowTypeImports: false,
  },
];

function listSourceFiles(directory: string): readonly string[] {
  const files: string[] = [];

  for (const entry of readdirSync(path.join(PROJECT_ROOT, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(relative));
    } else if (entry.isFile() && relative.endsWith(".ts")) {
      files.push(relative);
    }
  }

  return files.sort();
}

function readSource(relativePath: string): string {
  return readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

const sourceFiles = listSourceFiles(SOURCE_ROOT);

function describeViolations(violations: readonly Violation[]): string[] {
  return violations.map(
    (item) => `${item.file}:${String(item.line)} ${item.specifier} -> ${item.rule}`,
  );
}

/**
 * Each case below is the dependency its rule exists to stop. A scanner that reports
 * nothing for all of them would be reporting a clean tree for a tree it cannot read.
 */
const DETECTION_CASES: readonly (readonly [string, string])[] = [
  ["src/domains/shop/probe.ts", 'import { Page } from "playwright";\nexport type P = Page;'],
  [
    "src/domains/shop/probe.ts",
    'import type { CartLine } from "../../platform/contracts.js";\nexport type P = CartLine;',
  ],
  [
    "src/domains/shop/probe.ts",
    'import { PlatformError } from "../../platform/errors/index.js";\nexport const v = PlatformError;',
  ],
  [
    "src/domains/shop/probe.ts",
    'import { SHOP_ROUTES } from "../../applications/shop/configuration.js";\nexport const v = SHOP_ROUTES;',
  ],
  ["src/domains/probe.ts", 'import { Given } from "@cucumber/cucumber";\nexport const v = Given;'],
  ["src/steps/probe.ts", 'import { chromium } from "playwright";\nexport const v = chromium;'],
  [
    "src/steps/shop/probe.ts",
    'import { CartPage } from "../../applications/shop/pages/cartPage.js";\nexport const v = CartPage;',
  ],
  [
    "src/steps/shop/probe.ts",
    'import { BrowserSession } from "../../platform/browser/session.js";\nexport const v = BrowserSession;',
  ],
  [
    "src/applications/shop/pages/probe.ts",
    'import { CartService } from "../services/cartService.js";\nexport const v = CartService;',
  ],
  [
    "src/applications/shop/pages/probe.ts",
    'import { CheckoutJob } from "../../../jobs/shop/checkoutJob.js";\nexport const v = CheckoutJob;',
  ],
  [
    "src/applications/shop/pages/probe.ts",
    'import { rank } from "../../../platform/recovery/index.js";\nexport const v = rank;',
  ],
  [
    "src/applications/shop/pages/probe.ts",
    'import { suggest } from "../../../platform/ai/index.js";\nexport const v = suggest;',
  ],
  // The same dependency written to slip past a string match; it resolves to src/platform/ai.
  [
    "src/applications/shop/pages/probe.ts",
    'import { suggest } from "../../../domains/shop/../../platform/ai/index.js";\nexport const v = suggest;',
  ],
];

const TOLERATED_CASES: readonly (readonly [string, string])[] = [
  // A step may borrow a snapshot *type*; naming a driver type is not driving a browser.
  ["src/steps/shop/probe.ts", 'import type { Page } from "playwright";\nexport type P = Page;'],
  [
    "src/steps/shop/probe.ts",
    'import { CheckoutJob } from "../../jobs/shop/checkoutJob.js";\nexport const v = CheckoutJob;',
  ],
  [
    "src/domains/shop/probe.ts",
    'import type { CartLine } from "./types.js";\nexport type P = CartLine;',
  ],
  [
    "src/applications/shop/services/probe.ts",
    'import { CartPage } from "../pages/cartPage.js";\nexport const v = CartPage;',
  ],
  [
    "src/applications/shop/pages/probe.ts",
    'import type { AddRequest } from "../services/types.js";\nexport type P = AddRequest;',
  ],
];

describe("boundary scanner", () => {
  it("reads static, multi-line, re-exported, side-effect and dynamic imports", () => {
    const imports = importsOf(
      "src/jobs/probe.ts",
      [
        'import { existsSync } from "node:fs";',
        'import type { ExecutionContext } from "../platform/contracts.js";',
        "import {",
        "  createId,",
        '} from "../platform/observability/correlation.js";',
        'export { resolveFixtureUrl } from "../platform/fixtures/index.js";',
        'import "./support/register.js";',
        'const open = () => import("../platform/browser/session.js");',
      ].join("\n"),
    );

    expect(imports.map((item) => item.specifier)).toEqual([
      "node:fs",
      "../platform/contracts.js",
      "../platform/observability/correlation.js",
      "../platform/fixtures/index.js",
      "./support/register.js",
      "../platform/browser/session.js",
    ]);
    expect(imports.map((item) => item.typeOnly)).toEqual([false, true, false, false, false, false]);
    expect(imports.map((item) => item.resolved)).toEqual([
      undefined,
      "src/platform/contracts",
      "src/platform/observability/correlation",
      "src/platform/fixtures/index",
      "src/jobs/support/register",
      "src/platform/browser/session",
    ]);
  });

  it("does not mistake prose for a dependency", () => {
    const imports = importsOf(
      "src/jobs/probe.ts",
      [
        '// import { Page } from "playwright"; this is only a note about the API.',
        'const guide = "read the import statement in checkoutJob";',
        'import { CheckoutJob } from "./checkoutJob.js";',
      ].join("\n"),
    );

    expect(imports.map((item) => item.specifier)).toEqual(["./checkoutJob.js"]);
  });

  it("treats a mixed import as the value dependency it is", () => {
    const imports = importsOf(
      "src/steps/probe.ts",
      'import { type Page, chromium } from "playwright";',
    );

    expect(imports[0]?.typeOnly).toBe(false);
  });

  it.each(DETECTION_CASES)("detects the forbidden dependency in %s", (file, source) => {
    expect(
      describeViolations(findBoundaryViolations(file, source, BOUNDARY_RULES)),
      `${file}: ${source}`,
    ).not.toEqual([]);
  });

  it.each(TOLERATED_CASES)("leaves %s with %s alone", (file, source) => {
    expect(findBoundaryViolations(file, source, BOUNDARY_RULES)).toEqual([]);
  });

  it("names a file that drives the browser itself, and spares page objects", () => {
    expect(
      findLocatorViolations("src/steps/shop/probe.ts", 'await page.locator("#buy").click();'),
    ).toEqual([".locator(", ".click("]);
    expect(findLocatorViolations("src/applications/shop/pages/probe.ts", ".locator(")).toEqual([]);
  });
});

describe("source tree", () => {
  it("was large enough to be worth scanning", () => {
    // Guards against a pattern that matches nothing and reports a clean tree.
    expect(sourceFiles.length).toBeGreaterThan(40);
    expect(sourceFiles.filter((file) => file.startsWith("src/domains/")).length).toBeGreaterThan(3);
    expect(sourceFiles.filter((file) => `/${file}/`.includes("/pages/")).length).toBeGreaterThan(4);
  });

  it("keeps every declared layer boundary", () => {
    const violations = sourceFiles.flatMap((file) =>
      findBoundaryViolations(file, readSource(file), BOUNDARY_RULES),
    );

    expect(describeViolations(violations)).toEqual([]);
  });

  it("confines locator and element-driving calls to page objects", () => {
    const offenders = sourceFiles.flatMap((file) =>
      findLocatorViolations(file, readSource(file)).map((primitive) => `${file} uses ${primitive}`),
    );

    expect(offenders).toEqual([]);
  });
});
