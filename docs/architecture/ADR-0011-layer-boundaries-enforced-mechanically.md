# ADR-0011 — layer boundaries are enforced twice, mechanically

Status: accepted (Phase 2)

## Context

The build brief states three boundaries as requirements, not preferences: a recovery
component must not contain business workflows, a Page Object must not implement its own
AI/recovery engine, and a Cucumber step must not contain locator logic. Review discipline
does not hold those lines: the first ESLint configuration written for this repository
contained a pattern that looked correct and matched nothing. It failed nothing, and would
have kept failing nothing while everyone believed the boundary was enforced.

That is the reason this record exists. A boundary whose enforcement silently degrades is
worse than no boundary, because it buys unearned confidence.

## Decision

Four layers, with one dependency direction:

```text
Feature  ->  Step  ->  Job  ->  Service  ->  Page Object  ->  Playwright
                       |            ^
                       |            |
                    Domain  ---------'  (pure rules, imports nothing)
```

- **Step** (`src/steps/**`) binds Gherkin text to one Job call and holds scenario state in
  the World. It may name a _type_ from a service (a snapshot shape it asserts on) and may
  not name a driver, a page object or a browser internal.
- **Job** (`src/jobs/**`) is the execution boundary: it opens the `jobId` correlation span
  and calls Services. It is the only layer a step is allowed to orchestrate.
- **Service** (`src/applications/<app>/services/**`) decides what browser behaviour
  _means_ — authenticated versus rejected, arrived versus redirected, known versus
  unknown outcome. It consults the Domain for rules and never names an element.
- **Page Object** (`src/applications/<app>/pages/**`) owns element identity and the reading
  and writing of one page. It composes shared primitives from `navigation.ts`
  (`requireOne`, `waitForRoute`, `firstFulfilled`) instead of inheriting from a base class.
- **Domain** (`src/domains/**`) holds business rules in integer minor units and regular
  expressions. It imports nothing outside itself — not the browser, not Cucumber, not the
  platform, not even a type — so a rule can be tested with no page open.

Enforcement is deliberately doubled, because each half catches what the other cannot:

1. `eslint.config.js` uses `@typescript-eslint/no-restricted-imports` per directory. It
   understands the value/type distinction, so `import type` is tolerated for steps and page
   objects and refused for the domain, and it fires in the editor while code is being
   written.
2. `tests/unit/layerBoundaries.test.ts` scans the tree and asserts the same boundaries by
   **resolving** every specifier to a project path. `../../../domains/shop/../../platform/ai`
   is the same dependency as `../../../platform/ai`, and a string-matching linter can be
   walked past with `..`. It additionally checks that no step, job, service or domain file
   contains a locator or element-driving call at all, and it tests its own detector with
   thirteen forbidden and five permitted cases — a scanner that matched nothing would
   otherwise report a clean tree forever.

The domain boundary allows no type imports. A type leaves no runtime edge, but it lets a
UI concept into the vocabulary of a business rule, and that is how layers get merged back
together one refactor at a time.

Page objects are forbidden from importing `recovery`, `healing`, `heuristics`, `ai` and
`visual` directories that **do not exist yet**, and the probe confirms the rule fires
against them anyway. The boundary that matters most is the one set before the tempting code
arrives.

## Consequences

- Two places define one policy, so changing a boundary is a deliberate act rather than a
  one-line edit. That friction is the intended cost.
- The scan found two real violations in code already believed to be clean, and both were
  fixed rather than exempted: `PlatformHealthJob` read `[data-testid='health-status']`
  itself (now `HealthPage`), and `ShopNavigationService` called `page.goto()` and
  `page.url()` directly (now `ShopPage`). An exceptions list would have let both stand and
  made the rule conditional on who remembers the exemption.
- A new application target means a new `src/applications/<app>` directory with the same
  page/service split, and the existing rules apply to it without modification — which is
  the multi-application requirement tested structurally rather than hoped for.
- Still unenforced, and honestly so: nothing yet proves a _future_ recovery component will
  not contain business logic, because there is no recovery component. When Phase 4 adds
  `src/platform/recovery/`, a rule must be added here in the same change, not afterwards.
