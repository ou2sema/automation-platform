# ADR-0004 — validated configuration with a capability gate

Status: accepted (Phase 1)

## Context

The roadmap spans ten phases, and `.env.example` has to describe the whole surface
(recovery mode, healing memory, n8n, AI) before any of it exists. The predictable
failure is a team flipping `AP_RECOVERY_MODE=auto` in Phase 2, seeing no error, and
believing self-healing is active while nothing consumes the flag. Silent no-op
configuration is worse than a crash: it produces false confidence in test results.

A second hazard is credential leakage — a password in a config object that gets logged,
attached to a report, or forwarded to a webhook.

## Decision

1. **Parse primitives ourselves, validate the shape with zod.** `loader.ts` converts
   `AP_*` strings to numbers, booleans and enums, accumulating every problem so one run
   reports all misconfigurations instead of one at a time. `schema.ts` then owns the
   type and the ranges (`strictObject`, so an unexpected key is an error).
2. **`.env` cannot mutate `process.env`.** `configuration/env.ts` parses the file into
   its own record and keeps only `AP_*` keys, so an unrelated global variable can never
   reach the platform and importing the module cannot leak configuration into
   `process.env`. Precedence is environment-over-file by default, because CI and
   container runtimes inject values that must win over a stale local file;
   `readEnvironment({ fileOverridesProcessEnv: true })` inverts it for deliberate local
   experiments only.
3. **Secrets live in one schema node** (`secrets`), and `SENSITIVE_CONFIG_PATHS` is the
   single list that pino redacts. Anything that needs to report configuration uses
   `describeConfiguration()` / `describeConfigurationForEvent()`, which omit that node.
4. **`IMPLEMENTED_CAPABILITIES` is a build-time truth.** If configuration requests an
   engine whose flag is not yet implemented, `loadConfiguration()` throws with the phase
   that provides it:
   `AP_RECOVERY_MODE=suggest requires the recoveryEngine engine (Phase 4 and Phase 5).`
   Each phase flips its flag to `true` in the same commit as its first working code.

## Consequences

- No code path can read an unvalidated configuration value, and no flag can imply
  behaviour that does not exist. The cost is that the constant must be updated as part
  of each phase — which is the point: forgetting it is a visible bug.
- Tests construct configuration from an explicit environment record, so they never
  depend on a developer's `.env`.
- `n8n.enabled` additionally requires a webhook token once the adapter exists, guarded
  in the same function, so an unauthenticated receiver cannot be configured.
