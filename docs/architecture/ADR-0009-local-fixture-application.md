# ADR-0009 — a controlled local fixture stands in for the application under test

Status: accepted (Phase 1), extended in Phase 2

## Context

Phase 1 and Phase 2 need _something to automate_, and no real application was supplied.
The two tempting shortcuts are worse than they look:

- A public demo storefront (the-automation-practice-site pattern) adds a network
  dependency, changes without notice, and cannot be extended to exercise the failure
  modes Phase 4-6 require (renamed locators, ambiguous candidates, high-risk actions).
- `@playwright/test`'s `webServer` would mean running a static server for the baseline,
  adding a port, a process and a firewall question to prove a point that does not need
  them yet.

## Decision

`tests/fixtures/health-page/index.html` is loaded over `file://`, resolved by
`src/platform/fixtures/index.ts` (`resolveFixtureUrl`):

- The status text is rendered **by a script**, not hard-coded, so a pass proves
  JavaScript executed in a real browser rather than that a file was read.
- Elements carry `data-testid` and accessible roles/names, which is what the Smart UI
  layer (Phase 3) is meant to prefer over XPath or positional selectors.
- `resolveFixtureUrl()` rejects any path that resolves outside the fixtures root,
  including a sibling directory whose name merely starts with it. Gherkin table text
  reaches this function, so the guard is a boundary, not paranoia.
- The fixture directory is configuration (`AP_FIXTURES_DIR`), and the application is
  configuration too (`AP_APPLICATION`, `AP_BASE_URL`), so pointing the platform at a
  real target is a configuration change rather than a code change.

Phase 2 added `tests/fixtures/shop/`: five pages (`sign-in`, `catalogue`, `cart`,
`checkout`, `order-confirmation`) sharing one `shop.js`, driven by cross-page
`localStorage`. The assumptions that made this work were measured before five page
objects depended on them: a classic `<script src>` executes from a `file://` page (an ES
module graph would not), `localStorage` persists between pages of one browser context,
and it is invisible to another context — which is simultaneously the fixture's session
mechanism and the reason per-scenario isolation is provable against it.

The fixture declares its own pricing, tax and shipping constants. `src/domains/shop/`
declares the same rules again, independently. That duplication is the point: the flow
compares two implementations instead of trusting one, so a pricing regression fails a
scenario rather than being agreed into silence by an oracle that was edited to match the
bug. See ADR-0010 for the authentication decision.

## Consequences

- The Phase 1 and Phase 2 gates are reproducible offline: no port, no network, no shared
  staging environment, and no dependence on a third party's uptime.
- Against a remote application, `baseUrl` and an authentication job replace the fixture,
  and the same isolation, logging and event machinery applies unchanged — that is the
  point of the seam. What would change is the _credential_ story: a real target has real
  secrets, and the fixture was designed so that this repository never has one (ADR-0010).
- The fixture is not a substitute for the failure modes of a real UI. It will not rename
  a control between runs or serve a stale page.
- Deliberately deferred: a fixture that changes its own DOM between runs, which is what
  Phase 4/5 need to prove recovery of, and rejection of, ambiguous candidates. Today the
  integration suite duplicates a catalogue row at runtime to prove the platform refuses
  to choose between two matches (`tests/integration/shopFlow.test.ts`); a page that
  mutates itself is still a second fixture, not a mutation of this one.
