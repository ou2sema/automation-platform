/**
 * Cucumber runner configuration.
 *
 * `import` (not `require`) is the ESM-aware loader entry point: it registers the
 * support code and step definitions through the tsx TypeScript loader, so `.ts`
 * files are executable without a build step.
 *
 * `strict: true` means an undefined or pending step fails the run. A green suite must
 * never be achievable by silently skipping behaviour.
 *
 * `retry: 0` is deliberate. Automatic retries hide instability, and the roadmap
 * forbids reaching a pass by repeating failures. Flakiness is reported, not masked.
 */
export default {
  paths: ["features/**/*.feature"],
  import: ["src/support/**/*.ts", "src/steps/**/*.ts"],
  format: ["progress", "summary"],
  formatOptions: {
    snippetInterface: "async-await",
  },
  publish: false,
  strict: true,
  retry: 0,
  parallel: 0,
  order: "defined",
  backtrace: true,
  worldParameters: {
    runLabel: process.env.AP_RUN_LABEL ?? "local",
  },
};
