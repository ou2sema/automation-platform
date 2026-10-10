# ADR-0002 — Cucumber drives the `playwright` core library, not `@playwright/test`

Status: accepted (Phase 1)

## Context

Two runners want to own the same job. `@playwright/test` provides fixtures, project
matrix, webServer, tracing and retries — and its own test lifecycle, workers and hook
ordering. Cucumber provides Gherkin, step definitions, a per-scenario World and tag
driven selection. The brief requires Cucumber BDD as the authoring surface, so the
runner that owns a scenario must be Cucumber.

## Decision

Depend on `playwright` (the core library) and own the lifecycle explicitly:

- `src/support/hooks.ts` registers `BeforeAll`/`After` and constructs the
  `PlatformWorld`.
- `src/platform/browser/manager.ts` launches one browser **process** for the run.
- `src/platform/browser/session.ts` creates one **context + page** per scenario and
  finalises trace/video.
- The run-scoped composition root (`src/platform/runtime/runContext.ts`) wires
  configuration, logger, event bus and container once per process.

Cucumber configuration lives in `config/cucumber.mjs`: `strict: true`, `retry: 0`,
`parallel: 0`, `order: "defined"`, `publish: false`, formats `progress` + `summary`.

## Consequences

- No hidden fixture magic: browser lifecycle, isolation and artifacts are code in this
  repository, reviewable and testable — which is exactly what the Recovery Engine needs
  to hook into in Phase 4.
- We lose `@playwright/test` conveniences (auto wait-for assertions, project matrix,
  webServer). Page-state assertions therefore come from the Smart UI layer (Phase 3)
  rather than `expect(locator)`, and the fixture is served over `file://` (ADR-0009)
  instead of `webServer`.
- `retry: 0` is a policy, not an omission. Repeating a scenario until it passes hides
  the instability the platform is supposed to surface as healing debt.
- The `After` hook gets a 120 s ceiling so a wedged context cannot hang a suite beyond
  the run timeout.

## Alternatives considered

- **`@playwright/test` with a Cucumber reporter bridge.** Rejected: two lifecycle
  owners, and the Recovery Engine would have to reach into fixture internals.
- **Playwright test with Gherkin-styled `test()` calls.** Rejected: loses real Gherkin,
  which is the point of BDD for non-authoring stakeholders.
