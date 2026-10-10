import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "reports/**",
      "healing-data/**",
      "dist/**",
      "coverage/**",
      // Fixture pages and scripts are the simulated *application under test*, not
      // platform source. They run in a browser from `file://`, so they use DOM globals
      // this tsconfig does not include, and linting them would either force the
      // fixture to look like our code or push browser globals into our type graph.
      "tests/fixtures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      eqeqeq: ["error", "smart"],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-member-accessibility": "off",
    },
  },
  {
    // Plain JavaScript configuration files: no TypeScript project, and ESM globals
    // come from the runtime, so `no-undef` would only produce false positives.
    files: ["**/*.mjs", "config/**/*.js", "eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-undef": "off",
    },
  },
  {
    // Operational scripts log to stdout by design.
    files: ["scripts/**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-undef": "off",
      "no-console": "off",
    },
  },

  // ---------------------------------------------------------------------------
  // Layer boundaries. These three rules are stated as hard requirements for the
  // platform, so they are enforced by the linter rather than by review discipline.
  // A violation fails `npm run lint`, which fails CI.
  //
  //   1. a Cucumber step must not contain locator logic;
  //   2. business rules must not know a browser exists;
  //   3. a Page Object must not orchestrate, hold business rules, or own a
  //      recovery, healing or AI engine.
  //
  // `tests/unit/layerBoundaries.test.ts` asserts the same rules over the source
  // tree, because a boundary that can only be noticed by a linter configuration
  // that someone might edit is a boundary that will eventually be moved.
  // ---------------------------------------------------------------------------
  {
    files: ["src/steps/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["playwright", "@playwright/*"],
              message:
                "A step definition must not import a browser driver. Delegate to a Job; locator logic belongs in a Page Object.",
              allowTypeImports: true,
            },
            {
              group: ["**/pages/*", "**/pages"],
              message:
                "A step definition must not use Page Objects directly. Drive a Job, and let the Job compose the Services that use pages.",
              allowTypeImports: true,
            },
            {
              group: ["**/platform/browser/**"],
              message: "A step definition must not touch browser lifecycle internals.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/domains/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Nothing is allowed in: a domain that can reach the platform, the browser,
              // the runner or an application adapter is a domain that will grow I/O.
              group: [
                "playwright",
                "@playwright/*",
                "@cucumber/*",
                "**/platform/**",
                "**/applications/**",
                "**/jobs/**",
                "**/steps/**",
                "**/support/**",
              ],
              message:
                "Business rules must not depend on a browser, a runner, the platform or an application adapter. Keep the domain pure so it can be tested with no page open.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/applications/**/pages/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/jobs/**", "**/steps/**", "**/services/**"],
              message:
                "A Page Object describes one page. Orchestration belongs in a Service, and a use case belongs in a Job.",
              allowTypeImports: true,
            },
            {
              group: ["**/recovery/**", "**/healing/**", "**/ai/**", "**/heuristics/**"],
              message:
                "A Page Object must not implement its own recovery, healing or AI engine. Those decisions live in the Recovery Engine, which is subject to candidate ranking and risk policy.",
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
);
