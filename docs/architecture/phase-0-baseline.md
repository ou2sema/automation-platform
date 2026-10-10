# Phase 0 baseline — repository state, plan, risks

Date: 2026-10-10. Scope: Phase 0 (inspect and plan) plus the Phase 1 gate criteria.

## Repository state before this work

The working directory was an initialised git repository on branch `master` with **no
tracked source files** — no `package.json`, no lockfile, no tests, no CI. There was
therefore nothing to preserve or refactor, and the reference structure from the brief
could be adopted directly.

One deliberate deviation: the brief's tree shows a nested `automation-platform/` folder.
The repository root _is_ the platform, so `src/`, `features/`, `tests/`, `config/` and
`docs/` sit at the root. Nesting would have added a path level without adding a
boundary.

## Environment verified during Phase 0

| Item                              | Measured                                                                 |
| --------------------------------- | ------------------------------------------------------------------------ |
| OS                                | Windows 11 (10.0.22631), x64, Git Bash shell                             |
| Node.js                           | v24.x (satisfies `engines.node: ">=24.0.0"`)                             |
| npm                               | 11.x, lockfile committed as `package-lock.json`                          |
| Playwright browsers               | `npm run install:browsers` succeeded: chromium rev 1248 + headless shell |
| Chromium runtime                  | 156.0.8078.4, cold launch ~190–320 ms headless                           |
| Local network to the npm registry | available; all pins resolved on first attempt                            |

## Minimum viable vertical slice

Chosen so that every architectural layer is exercised by one thin path, rather than
building layers that nothing calls:

```text
features/platform/health-check.feature
  -> src/steps/platformHealth.steps.ts        (thin step definitions)
    -> src/jobs/platformHealthJob.ts          (execution boundary, correlation span)
      -> Playwright page via BrowserSession   (scenario-scoped context)
        -> tests/fixtures/health-page/index.html  (controlled local application)
  -> structured logs + events + artifacts     (run/scenario identifiers)
```

The Cucumber World implements `ExecutionContext`, which is the only surface Jobs see.
That single interface is what keeps business logic free of Cucumber and Playwright
mechanics, and it is testable in Phase 1 without a browser (unit tests) and with one
(browser tests).

## Risks and current status

| #   | Risk                                                                                                 | Mitigation adopted                                                                                                     | Status after Phase 1                                           |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Playwright browser download blocked or absent in the environment                                     | Pin `playwright`, expose `npm run install:browsers`, have `scripts/doctor.mjs` verify the executable path              | Cleared — Chromium present, launches in < 400 ms               |
| 2   | ESM + Cucumber 13 + TypeScript loader not interoperable                                              | `tsx` via `node --import`, `import` (not `require`) in `config/cucumber.mjs`, `module: NodeNext` with `.js` specifiers | Cleared — 14 BDD steps execute                                 |
| 3   | TypeScript 7 (beta at the time of writing) breaks `typescript-eslint` peer ranges                    | Pin `typescript@5.9.3` and `typescript-eslint@8.71.1` explicitly                                                       | Cleared — typecheck and lint both green                        |
| 4   | Cucumber invokes each step in a fresh async context, so AsyncLocalStorage alone loses scenario scope | Correlation carried by two mechanisms on purpose — see ADR-0008                                                        | Cleared — log lines carry `runId`/`scenarioId`/`jobId`         |
| 5   | Configuration flags for unimplemented engines invite fake behaviour                                  | `IMPLEMENTED_CAPABILITIES` gate hard-fails any request for recovery/healing memory/n8n/AI                              | Cleared — enabling a flag aborts the run with the phase number |
| 6   | Shared browser state leaks between scenarios                                                         | One `BrowserContext` per scenario, disposal in `After` even on failure                                                 | Cleared — `tests/integration/browserIsolation.test.ts`         |
| 7   | Teardown errors replace the real scenario result                                                     | Disposal failures recorded and logged, never thrown                                                                    | Cleared — container test asserts recorded-not-thrown           |
| 8   | A slow or unavailable external integration blocks execution                                          | Event bus delivers asynchronously with a bounded queue and `flush()`                                                   | Cleared for the bus itself; n8n adapter is Phase 8             |
| 9   | Retries masking flakiness                                                                            | `retry: 0` in the Cucumber config, documented as intentional                                                           | Cleared                                                        |

## Phase 1 acceptance criteria (the gate)

1. `npm ci` reproduces the toolchain from the committed lockfile.
2. `npm run typecheck` and `npm run lint` exit 0.
3. `npm run test:unit` passes with real assertions on framework behaviour, not smoke
   checks of constructors.
4. `npm run test:bdd` executes at least one scenario end-to-end through the layer stack.
5. Every scenario is isolated: its own context, its own World, its own identifiers.
6. Configuration is validated and secrets are redacted at the transport boundary.
7. `npm run doctor` diagnoses a broken environment without reading a stack trace.

Recorded results are in `docs/roadmap.md` (Phase 1 section) and in the Phase 1 report.

## Assumptions

- **No real application was available.** A local `file://` fixture stands in for it
  (ADR-0009). Application-specific configuration, Page Objects and adapters are added
  in Phase 2 against whatever target is chosen.
- **Single-user local development first.** CI is added at the end of Phase 1 so the
  same commands run in both places; parallel execution is deferred to Phase 10.
- Healing memory, recovery, n8n and AI are **not** implemented, and cannot be enabled
  by configuration in this build.
