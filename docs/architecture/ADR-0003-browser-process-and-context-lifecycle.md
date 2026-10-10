# ADR-0003 — one browser process per run, one context per scenario

Status: accepted (Phase 1)

## Context

Full isolation and speed pull in opposite directions. Launching a browser per scenario
costs 200–400 ms each, which is fine for ten scenarios and unbearable for a thousand.
Sharing a page or a context between scenarios leaks cookies, storage, service workers
and navigation state, which produces the ordering-dependent failures that later get
mistaken for "flaky UI".

The isolation contract has to be a property of the code, not a habit of the author.

## Decision

- `BrowserManager` owns the **process**. It launches lazily, collapses concurrent first
  launches into one promise, and is registered in the run scope so it is disposed once.
- `BrowserSession` owns the **context and page** for exactly one scenario, created via
  `browser.newContext()` with viewport and locale from configuration. It is created
  lazily by the World on first `page()` access, so a scenario that never touches the
  browser pays nothing.
- Artifacts are namespaced `reports/artifacts/<runId>/<scenarioId>/`, so a future
  parallel worker cannot collide with another's trace or video.
- Trace and video follow the configured mode (`off`, `on`, `retain-on-failure`). The
  status is recorded by the `After` hook _before_ disposal, and an unknown outcome is
  treated as needing artifacts — losing the ability to diagnose an ambiguous result is
  worse than keeping a large file.
- The `Video` handle is taken **before** `context.close()`, because it is unreachable
  afterwards.
- A passing scenario with no retained artifacts has its directory removed, so a green
  suite leaves nothing behind.

## Consequences

- Scenarios are independent and can be reordered or selected by tag without changing
  results; `tests/integration/browserIsolation.test.ts` asserts this rather than
  trusting it.
- A browser crash affects every scenario in the run. Accepted: it is an environment
  failure, classified as such in Phase 4, and does not silently contaminate results.
- Context creation is the per-scenario cost (~50 ms), which is the price of isolation
  and is measured rather than assumed.
