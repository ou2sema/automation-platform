# Implementation roadmap and gate status

Living checklist for this build. Update the status column in the same commit that changes
the code, so the file stays a record rather than a promise.

Progress is gated: a phase does not start until the previous phase's gate has been
measured, not assumed. "Implemented" means code that runs in the vertical slice, with a
test that would fail if the behaviour were removed.

## Status

| Phase | Scope                                       | Gate                                                                                              | Status         | Evidence                                                                             |
| ----- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| 0     | Inspect, plan, baseline                     | Architecture and risks recorded before code                                                       | **done**       | `docs/architecture/phase-0-baseline.md`, ADR-0001…0011                               |
| 1     | Engineering foundation                      | Installs reproducibly, typechecks, lints, and executes a minimal Cucumber scenario with isolation | **done**       | see "Phase 1 measured results"                                                       |
| 2     | Business-domain foundation                  | One meaningful end-to-end business flow passes without self-healing                               | **done**       | see "Phase 2 measured results"                                                       |
| 3     | Smart UI interaction layer                  | Standard interactions work reliably and produce structured diagnostics on failure                 | not started    | —                                                                                    |
| 4     | Failure classification and safe recovery    | Only eligible failures enter recovery; strategies 1–5 ordered as specified                        | not started    | —                                                                                    |
| 5     | Candidate ranking, risk, outcome validation | Recovers on controlled UI change, refuses ambiguity and high-risk cases                           | not started    | —                                                                                    |
| 6     | Persistent healing memory                   | Survives restart, concurrency-safe, rejects stale/unvalidated mappings                            | not started    | —                                                                                    |
| 7     | Observability, reporting, failure analysis  | An engineer can explain why a test failed and why recovery did or did not run                     | not started    | —                                                                                    |
| 8     | n8n integration                             | Simulated outage, timeout, malformed and duplicate events do not corrupt results                  | not started    | —                                                                                    |
| 9     | AI and advanced recovery providers          | Deterministic recovery is reliable first; AI output treated as untrusted                          | not started    | —                                                                                    |
| 10    | CI/CD, parallelism, scaling                 | Parallel workers stay isolated; pipeline enforces the same commands as local                      | partially done | CI runs doctor, types, lint, format, self-tests and BDD; parallel execution deferred |

## Phase 1 measured results

Run on 2026-10-10 on Windows 11 x64, Node v24, Chromium 156.0.8078.4 (rev 1248).

| Check                   | Command                                      | Result                                                                           |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| Install reproducibility | `npm ci` with committed `package-lock.json`  | passes; 15 packages match pins (`npm run doctor`)                                |
| Environment             | `npm run doctor`                             | 7/7 checks pass, 0 warnings                                                      |
| Types                   | `npm run typecheck`                          | 0 errors, strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`     |
| Lint                    | `npm run lint`                               | 0 errors, type-aware ruleset, no `any` escapes                                   |
| Format                  | `npm run format:check`                       | clean                                                                            |
| Framework self-tests    | `npm run test:unit`                          | **107 tests in 9 files pass** (101 unit + 6 browser integration)                 |
| BDD slice               | `npm run test:bdd`                           | **2 scenarios / 14 steps pass**, 2 hooks pass, ~0.8 s                            |
| Isolation               | `tests/integration/browserIsolation.test.ts` | distinct contexts/pages, cookie jar and `localStorage` do not cross scenarios    |
| Correlation             | BDD log output                               | `runId`, `scenarioId`, `jobId` on every record; distinct per scenario in one run |
| Artifacts policy        | integration test                             | passing scenario leaves no directory; failing scenario retains `trace.zip`       |
| Capability gate         | `tests/unit/configuration.test.ts`           | enabling recovery/healing/n8n/AI flags aborts the run naming the phase           |

Self-test breakdown: configuration 25, container 21, events 17, correlation 11, errors 9,
logger 8 (incl. redaction at the transport boundary), fixtures 6, timing 4, browser
isolation 6.

## Phase 2 measured results

Run on 2026-10-10 on Windows 11 x64, Node v24, Chromium 156.0.8078.4 (rev 1248).

| Check                | Command                                  | Result                                                                                                                 |
| -------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Types                | `npm run typecheck`                      | 0 errors, strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`                                           |
| Lint                 | `npm run lint`                           | 0 errors, including the three layer-boundary rules                                                                     |
| Format               | `npm run format:check`                   | clean                                                                                                                  |
| Framework self-tests | `npm run test:unit`                      | **184 tests in 14 files pass** (77 new since Phase 1: pricing 21, display 12, order 10, boundaries 25, browser flow 9) |
| BDD slice            | `npm run test:bdd`                       | **11 scenarios / 82 steps / 2 hooks pass**, 6.85 s                                                                     |
| Business flow        | `features/shop/purchase-flow.feature`    | 2 keyboards + 3 cables → 12797 subtotal + 1024 tax = **13821 charged**, 5 units, `ORD-0001`, one order in the session  |
| Independent oracle   | `tests/unit/shopPricing.test.ts` + flow  | fixture pricing and `src/domains/shop/pricing.ts` are separate implementations; the flow compares them                 |
| Boundary enforcement | 16-case probe matrix + `layerBoundaries` | every forbidden import fails a run; type imports allowed for steps/pages and refused for the domain                    |
| Ambiguity refusal    | `tests/integration/shopFlow.test.ts`     | duplicated catalogue row → `ELEMENT_AMBIGUOUS`; the platform refuses to pick one                                       |
| Isolation            | same file, two contexts                  | one scenario's session and cart are invisible to the next                                                              |
| Credential hygiene   | same file                                | password, delivery note and per-scenario token absent from every log record; field cleared; nothing in markup          |
| Unknown outcome      | `src/applications/shop/navigation.ts`    | a non-fulfilled race reports the state as unknown and fails, instead of guessing                                       |
| Capability gate      | unchanged                                | recovery, healing, n8n and AI all still `false`; `recoveryMode: observe`                                               |

Three things were measured before being built on: `file://` executes a classic
`<script src>` (an ES module graph would not), `localStorage` persists between pages of one
context, and it does not cross contexts. The fixture was also driven green by a throwaway
script — including its arithmetic — before any TypeScript was written on top of it.

### Corrections found by checking rather than assuming

- A boundary rule that appeared not to fire in a first probe could not be reproduced, and
  the 16-case matrix is the record that is trusted. The unresolved discrepancy is the
  reason the same boundaries are asserted a second time in
  `tests/unit/layerBoundaries.test.ts` (ADR-0011).
- The scanner found two real violations in code already believed clean, and both were
  fixed rather than exempted: `PlatformHealthJob` read a `data-testid` selector itself (now
  `HealthPage`), and `ShopNavigationService` called `page.goto()` and `page.url()` directly
  (now `ShopPage`).
- A comment claimed binary-float drift could flip a cent at 8% tax. It cannot: the two
  forms agree for every subtotal up to 50,000 USD cents, so the claim was replaced with the
  reason that is actually true (integer intermediate, deterministic rounding).
- Two negative-path steps originally "passed" by waiting out a 15 s navigation timeout
  inside a 5 s Cucumber step timeout, i.e. they failed for the wrong reason. Detecting the
  rejection instead of its absence cut the suite from 16.2 s with 2 failures to 6.9 s green.

## Known gaps carried into Phase 3

- **No event subscribers yet.** `run.finished` reports `delivered: 0` because nothing is
  listening; the bus is exercised by tests, not by a reporter. Phase 7 attaches the
  reporting sink, Phase 8 the n8n adapter. Expected, not a defect — but a run showing
  `dropped > 0` or `failed > 0` is a real diagnostics gap.
- **Page objects speak CSS attribute selectors only.** Every shop control is found by
  `[data-testid='…']` or a text-bearing descendant. Nothing yet prefers a role or an
  accessible name, and there is no structured interaction diagnostic, which is exactly the
  Phase 3 gate.
- **Failures propagate raw.** `ELEMENT_AMBIGUOUS`, `ELEMENT_NOT_FOUND`,
  `EXTRACTION_FAILED` and `BUSINESS_RULE_VIOLATED` exist and are raised, but nothing
  consumes them: there is no `FailureCategory` classification, no eligibility decision and
  no recovery, so every failure ends the scenario. That is intentional — stability before
  intelligence — and it is why the phase flags stay off.
- **The target is a fixture, not an application.** Authentication is a password-policy
  check with no credential stored (ADR-0010), there is no server, no seeded account and no
  real session lifetime. Pointing the same layers at a real target is a configuration and
  adapter change, and it will expose things the fixture cannot: network latency, partial
  navigation, and genuine secret handling under redaction.
- **The fixture never mutates itself.** Ambiguity is currently produced by the test
  duplicating a row. Phase 4/5 need a target that changes its own DOM between runs.
- `parallel: 0` in `config/cucumber.mjs`, deliberately, until Phase 10.
- `src/index.ts` does not re-export the shop or domain modules. The barrel is the
  platform's public surface; the shop is a sample adapter, and nothing imports it through
  the barrel yet.

## Phase 3 plan (next)

Goal: standard interactions work reliably and produce structured diagnostics on failure —
still with recovery, healing, n8n and AI unimplemented and unenableable.

1. Introduce the Smart UI interaction layer: one small component that performs
   locate-then-act, preferring accessible name/role and test id over positional or
   structural selectors, and returns a structured result rather than a Playwright stack.
2. Route page objects through it by composition. A page object must still not own a
   recovery, healing or AI engine (ADR-0011), and the boundary rules gain a new directory
   in the same change that adds it.
3. Emit structured failure diagnostics: the DOM fragment, candidate list and reason for a
   refusal, captured **on failure or diagnostic runs only**, since artifacts are expensive.
4. Add the `FailureCategory` union and the classification that will feed Phase 4, without
   letting any recovery decision depend on it yet.
5. Gate: the existing 11 scenarios still pass with the interaction layer in place, a
   deliberately broken selector produces a structured diagnostic rather than a stack
   trace, and `npm test` plus `npm run format:check` stay green.

## Working agreement for every phase

State the goal and acceptance criteria → inspect the current code → design briefly →
implement connected functionality (no stubs) → add tests that would fail without it → run
`npm test` and `npm run format:check` → update this file and the ADRs → report actual
results → only then start the next phase.
