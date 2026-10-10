# ADR-0010 — the fixture authenticates against a policy, so no credential exists to leak

Status: accepted (Phase 2)

## Context

A purchase flow is not testable without a session, and a session normally implies a
password. This repository must not contain one: the build brief forbids credentials in
source control, and every layer added in Phase 6 and Phase 8 (healing memory, event
delivery, AI candidates) is a place a stored secret could later be copied into. A test
account committed as `hunter2` would sit in the fixture, in the feature file, in generated
test data, in log samples and in any artifact anyone ever attached to a bug report.

The other problem is specific to automation: a login form that accepts anything is not a
test target, because the negative path cannot be exercised at all.

## Decision

`tests/fixtures/shop/shop.js` authenticates against an **account directory and a published
password policy** (`minLength: 8`, `requireDigit`) rather than against a stored credential
value. An account is a name and a display name; the password a visitor types is checked
against the policy, and no expected-value comparison ever happens. There is therefore no
password literal anywhere in the project to commit, leak, or redact.

The test side never introduces a secret either:

- `src/support/shopTestData.ts` derives the account name and a policy-satisfying password
  from the scenario's correlation id with FNV-1a, not `Math.random()`. A failing scenario
  re-runs with the same values; two scenarios never share them, which is what makes a
  context-leak detectable instead of merely unlikely.
- `REJECTED_PASSWORD` is `short` — below the minimum and digit-free. It is a shape, so it
  exercises the refusal path without being a credential.
- `ShopSession` in the domain has `username` and `displayName` and deliberately no
  credential field. Nothing downstream can receive a password, so no layer can log or
  persist one by accident.
- The sign-in page clears the password field before validating and answers both an unknown
  account and a policy violation with one identical message, so a probe cannot enumerate
  account names.
- `SignInService` reports `credentialInMarkup` and `passwordCleared` as booleans rather
  than returning markup or field values, and the password appears in no result, log
  record, event payload or assertion context. `tests/integration/shopFlow.test.ts` asserts
  the absence, and asserts that the run logged something first — an absence check on an
  empty log proves nothing.

## Consequences

- Positive: the hygiene properties are testable today with zero secret material, so the
  same assertions stay green in a public repository or a shared CI log.
- Honest limit: this fixture does not verify a credential, so the suite proves session and
  access-control _mechanics_, not authentication correctness. Against a real target,
  credentials come from the environment or a secret store, the account is seeded, and
  `SENSITIVE_CONFIG_PATHS` redaction plus these same log-absence assertions become the
  control — that path is exercised in Phase 7/8, not claimed now.
- A second limit: the policy is global, so a test cannot prove the application rejects a
  _stolen_ password. It proves it rejects a malformed one, which is the case the UI can
  actually distinguish.
- Naming an account directory `ada`/`bo` keeps the fixture's account set visible to
  `SHOP_ACCOUNTS` in the adapter. Adding an account is a fixture change; adding a real
  credential is not permitted by this decision.
