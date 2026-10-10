# ADR-0006 — pino structured logs with correlation merged at emit time

Status: accepted (Phase 1)

## Context

A test platform produces two audiences: an engineer reading a console during a local
run, and a machine that has to group failures by application, environment and element
(Phase 7 reporting, Phase 8 n8n triage). Free-text logging serves the first and defeats
the second. The other constraint is leakage: automation logs are unusually close to
credentials, because the platform holds form values and secrets in memory.

## Decision

- **pino** as the transport, wrapped by a `PlatformLogger` interface so the rest of the
  codebase never imports pino directly and the transport can be replaced without
  touching call sites.
- Every record is `message + structured context`, with the correlation identifiers
  merged in at emit time. Precedence is explicit:
  `bindings → call-site context → static (run/scenario) correlation → async-local span`.
- **Redaction lives in the transport**, not in the caller: `SENSITIVE_CONFIG_PATHS` is
  configured on the pino instance, so a secret cannot escape because someone forgot to
  mask a field they passed in.
- `errorFrom(cause, message, context)` normalises any thrown value through
  `toErrorReport()`, so logs and reports carry the same code/severity/retryable shape
  regardless of whether the failure was a `PlatformError`, a native `Error`, or a
  non-Error throw.
- `createLoggerWithSink()` and `MemorySink` exist for self-tests: assertions are made on
  level, message and record contents without capturing stdout.
- Human-readable output is opt-in (`AP_LOG_PRETTY`, `pino-pretty`); the default is
  newline JSON, which is what CI log viewers and n8n need.
- OpenTelemetry is **not** introduced in Phase 1. The correlation chain
  (`runId → scenarioId → jobId → actionId → recoveryAttemptId`) already gives spans the
  identifiers OTel would assign; adopting it later means mapping these onto trace/span
  ids rather than rewriting the logging call sites. The decision to revisit is recorded
  for Phase 7.

## Consequences

- `npm run test:bdd` emits one JSON record per event, greppable by identifier; with
  `AP_LOG_PRETTY=true` the same records render colourised for local work.
- The log surface is testable. `createLoggerWithSink()` covers level filtering, binding
  inheritance, correlation merging and error normalisation in memory; `createLogger()`
  additionally accepts a destination stream, so one test asserts redaction against the
  bytes pino actually writes instead of trusting the configuration.
- Call sites must pass context as data rather than interpolating sentences. That is the
  point, and it is enforced socially in reviews: the interface accepts both, so nothing
  stops a contributor from writing `logger.info(\`x ${y}\`)`.
