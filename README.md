# Automation Platform

A reusable, production-minded UI automation platform: **TypeScript (strict) + Playwright +
Cucumber BDD**, built in gated phases so that reliable interaction, controlled
self-healing, audited healing memory and external orchestration can be added on a base
that already works.

**Current status: Phase 2 (business-domain foundation) complete.** Deterministic
execution, scenario isolation, structured logging, correlation, validated configuration and
standardised failure reporting are implemented and measured, and one real business flow —
sign in, browse, add to cart, check out, place one order — passes end to end against a
five-page local application. The recovery engine, healing memory, n8n and AI providers are
**not implemented**, and this build refuses to start if they are enabled by configuration —
see [Capability gate](#capability-gate).

Progress and gate evidence: [`docs/roadmap.md`](docs/roadmap.md). Design rationale:
[`docs/architecture/`](docs/architecture/).

## Quick start

```bash
npm ci                    # exact toolchain from package-lock.json
npm run install:browsers  # Playwright Chromium for the pinned version
npm run doctor            # environment check: node, deps, browser, config, writability, secrets
npm test                  # typecheck -> lint -> self-tests -> BDD slice
```

`npm run doctor` is the first thing to run when anything fails to start; it explains the
problem instead of printing a Playwright stack trace.

## Commands

| Command                           | Purpose                                                                    |
| --------------------------------- | -------------------------------------------------------------------------- |
| `npm run typecheck`               | `tsc --noEmit`. There is no build output; `tsx` runs TypeScript directly   |
| `npm run lint` / `lint:fix`       | Type-aware ESLint (no `any`, no floating promises, no unawaited thenables) |
| `npm run test:unit`               | Vitest framework self-tests, including real-browser isolation tests        |
| `npm run test:bdd`                | Cucumber scenarios through the whole layer stack                           |
| `npm run format` / `format:check` | Prettier                                                                   |
| `npm run doctor`                  | Environment and configuration diagnostics                                  |
| `npm run install:browsers`        | Install Playwright browser binaries                                        |

Verbose, human-readable logs locally: `AP_LOG_PRETTY=true npm run test:bdd`.

## Architecture

```text
Feature        features/**            Gherkin, tagged
  -> Step      src/steps/**           binds text to one Job call; no locators
     -> Job    src/jobs/**            execution boundary, correlation span, orchestration
        -> Service      src/applications/<app>/services/**
        ^                  decides what browser behaviour *means*
        -> Domain        src/domains/**  business rules; imports nothing at all
        -> Page Object   src/applications/<app>/pages/**
           -> Playwright (element identity stops here)
              -> Smart UI   Phase 3
                -> Recovery Phase 4-5
```

`src/applications/<app>/` is one adapter per target application: its configuration, page
objects and services. `src/domains/<domain>/` holds the rules — money in integer minor
units, eligibility, formats — with no browser, runner or platform import at all, so a rule
is testable with no page open. The shop flow's totals are checked against that independent
domain calculation, not against the application's own arithmetic.

Platform core lives in `src/platform/` and knows nothing about any application:

```text
src/platform/
  browser/          one process per run, one context per scenario, artifacts
  configuration/    zod schema, .env isolation, capability gate, redaction paths
  contracts.ts      ExecutionContext — the only surface a Job sees
  cucumber/         PlatformWorld (implements ExecutionContext)
  dependency-injection/  tokens, run and scenario scopes, disposal ordering
  errors/           error taxonomy, serialisable ErrorReport, cycle-safe causes
  events/           typed event catalogue, async error-isolated bus
  fixtures/         resolves the controlled target pages, path-traversal guarded
  observability/    correlation chain + pino logger
  runtime/          composition root for one process run
  timing/           bounded awaits for APIs with no native timeout
```

Three rules keep the layers honest, and they are enforced by tooling rather than by review:

- a recovery component must not contain business workflows;
- a Page Object must not implement its own locator-recovery logic — including engines that
  do not exist yet, so the rule is armed before the temptation is;
- a Cucumber step must not contain locator code.

`eslint.config.js` restricts imports per directory, and
[`tests/unit/layerBoundaries.test.ts`](tests/unit/layerBoundaries.test.ts) re-states the
same boundaries by resolving every import to a real path and by checking which files may
name a locator at all. The second copy exists because a linter pattern that quietly stops
matching removes the boundary and keeps the green tick — see ADR-0011.

## Scenario isolation

Every scenario gets its own `BrowserContext`, `Page`, World, artifact directory and
correlation identifiers. One browser process is shared for speed; nothing else is.
Cookies, `localStorage` and DOM state written by one scenario are asserted — in
`tests/integration/browserIsolation.test.ts` — not to be visible to the next one.

`tests/integration/shopFlow.test.ts` proves the same thing about the application's own
state: a session and a cart built in one context cannot be seen from the next, which is
what makes per-scenario generated test data a guarantee rather than a habit. That file also
holds the safety assertions Gherkin is a poor place for — an ambiguous element is refused
rather than guessed at, and no password, delivery note or per-scenario token reaches a log
record (checked after confirming the run logged something, since absence in an empty log
proves nothing).

`retry: 0` in `config/cucumber.mjs` is deliberate: repeating a scenario until it passes
hides instability, and this platform is supposed to surface it.

## Configuration

All settings are `AP_*` environment variables, documented in
[`.env.example`](.env.example); copy it to `.env` to override locally. `.env` is git
ignored and is never merged into `process.env`; the real environment always wins, so CI
and container injection cannot be shadowed by a stale local file.

Secrets (`AP_N8N_WEBHOOK_TOKEN`, `AP_AI_API_KEY`) sit in their own configuration node and
are redacted at the log transport, so they cannot reach stdout, reports or event payloads
even if a caller passes them by mistake. Never commit a real value; `.env.example` keeps
every secret empty.

### Capability gate

`src/platform/configuration/loader.ts` declares which engines exist in this build:

```ts
export const IMPLEMENTED_CAPABILITIES = {
  recoveryEngine: false,
  healingMemory: false,
  n8n: false,
  ai: false,
} as const;
```

Setting `AP_RECOVERY_MODE=suggest`, `AP_HEALING_MEMORY_ENABLED=true`, `AP_N8N_ENABLED=true`
or `AP_AI_ENABLED=true` aborts the run with the phase that will provide it. A flag being
documented does not mean the behaviour exists, and this build will not let you believe it
does.

## Adding a scenario

1. Describe the behaviour in `features/<area>/<name>.feature` with tags (`@ui`,
   `@smoke`, `@critical`, …).
2. Write a thin step definition in `src/steps/` that calls exactly one Job. A step may name
   a _type_ from a service; it may not name a driver, a page object or a locator.
3. Implement the Job in `src/jobs/`. It receives `ExecutionContext`
   (`correlation`, `logger`, `config`, `page()`), opens its own span with
   `runWithin(this.context.correlation, { jobId: createId("job") }, …)`, and returns a
   typed result.
4. Put the decision in a Service (`src/applications/<app>/services/`), the element identity
   in a Page Object (`src/applications/<app>/pages/`), and the business rule in
   `src/domains/<domain>/` — which imports nothing, so a rule can be tested with no page
   open and then compared against what the application actually displays.
5. Generate scenario-scoped test data from the correlation id rather than
   `Math.random()` (see `src/support/shopTestData.ts`), so a failure can be re-run and two
   scenarios cannot collide.
6. Add fixtures under `tests/fixtures/` and reference them through `resolveFixtureUrl()`.
7. Run `npm test`. `tests/unit/layerBoundaries.test.ts` fails the run if any rule above was
   shortcut.

## Troubleshooting

| Symptom                                                                      | Cause and fix                                                                                                           |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Unable to launch the chromium browser because its executable is missing`    | Run `npm run install:browsers`. Playwright binaries are pinned to the `playwright` version, not shared between versions |
| `Configuration requests capabilities that are not implemented in this build` | A phase flag was enabled early. Leave it at its default or implement the phase                                          |
| `Correlation requires runId`                                                 | Work started outside an initialised run. Use `ExecutionContext.correlation` as the base, or `runWithin()`; see ADR-0008 |
| `Attempted to resolve from the already-closed scenario scope`                | Something continued after the scenario ended (usually an unawaited promise). Await your work inside steps               |
| A step is reported `undefined` and the run fails                             | `strict: true` is on: implement or remove the step; do not skip it                                                      |
| Logs are unreadable JSON                                                     | `AP_LOG_PRETTY=true`                                                                                                    |
| `npm ci` differs from a teammate's install                                   | The lockfile is committed; do not hand-edit `package.json` versions, they are exact pins                                |

## Documentation index

| Document                                                                         | Content                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`docs/roadmap.md`](docs/roadmap.md)                                             | Phase status, measured results, known gaps, Phase 3 plan                                                                                                                                                           |
| [`docs/architecture/phase-0-baseline.md`](docs/architecture/phase-0-baseline.md) | Starting state, environment, vertical slice, risk register                                                                                                                                                         |
| `docs/architecture/ADR-0001`…`ADR-0011`                                          | Toolchain, runner choice, browser lifecycle, configuration policy, DI, logging, event bus, correlation across Cucumber steps, the fixture application, credential-free authentication, mechanical layer boundaries |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml)                           | The same checks on every push                                                                                                                                                                                      |
