# ADR-0008 — correlation by AsyncLocalStorage _and_ World-held scope

Status: accepted (Phase 1)

## Context

The observability model requires an identifier chain:

```text
runId -> scenarioId -> jobId -> actionId -> recoveryAttemptId
```

The obvious implementation is AsyncLocalStorage alone. It is not sufficient here, and the
reason is specific to Cucumber: **each step definition is invoked in its own async
context**. A `Before` hook that enters an ALS scope does not propagate it into the
following `Given`/`When` steps, and there is no supported way to make Cucumber wrap the
whole scenario in one. Proved empirically in Phase 1: the first vertical slice failed
with `Correlation requires runId.` in both scenarios for exactly this reason.

## Decision

Two mechanisms, each used where it actually holds:

1. **Scenario scope is a value, not ambient.** `PlatformWorld` carries
   `correlation: CorrelationIds` (run + scenario ids) and passes it to everything it
   constructs — logger (as `staticCorrelation`), sessions, Jobs. Because the World is a
   per-scenario object, this survives across steps without depending on async context.
2. **Sub-scenario spans are ambient.** `runWithin(base, overlay, body)` enters an ALS
   scope seeded from the explicit base rather than from ambient storage, and Jobs use it
   around their own work:

   ```ts
   await runWithin(this.context.correlation, { jobId: createId("job") }, () => this.run());
   ```

   Inside that body, action ids and (from Phase 4) recovery attempt ids nest normally,
   because the work is awaited within the same async chain.

At emit time the logger merges both, with ambient last so the innermost span wins:

```text
bindings -> call-site context -> static correlation -> async-local store
```

`mergeCorrelation()` refuses to produce a correlation without a `runId`. A run that has
not been initialised fails loudly at the first boundary instead of silently generating
unattributable logs.

## Consequences

- The chain is complete in practice: `run.started`, `scenario.started`, job and action
  spans all carry the identifiers of the work that produced them, verified in the BDD
  output.
- The cost is a rule contributors must learn: **do not rely on ambient scope for scenario
  identity; take it from `ExecutionContext`.** `withCorrelation()` keeps its ambient
  behaviour for genuinely nested calls, and its doc comment points here.
- Phase 7 can map `runId`/`scenarioId`/`jobId` onto trace and span ids without changing
  any call site, because the identifiers are already passed explicitly at boundaries.
