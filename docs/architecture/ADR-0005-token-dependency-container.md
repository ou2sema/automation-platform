# ADR-0005 — token-based container with run and scenario scopes

Status: accepted (Phase 1)

## Context

The brief requires "dependency injection or a lightweight scenario-scoped composition
mechanism" with explicit dependencies, and forbids a single mutable global `Page` or
shared scenario state. Decorator-based IoC frameworks (InversifyJS, tsyringe) need
`experimentalDecorators`/`emitDecoratorMetadata`, which conflict with
`erasableSyntaxOnly` and make a dependency graph invisible to the reader.

The real requirement is narrower than a framework: values must be created once per
scope, isolated between scenarios, and disposed in a controlled order even after a
failure.

## Decision

`src/platform/dependency-injection/container.ts`:

- `createToken<T>(name)` returns a typed token with a phantom field; no reflection, no
  metadata, no decorators.
- Two scope kinds. `createRunScope()` for the process, `createScenarioScope(run)` for a
  scenario. A scenario scope must be built from a run scope — passing another scenario
  throws, so cross-scenario sharing cannot happen by accident.
- A registration declares which scope owns it. `scope: "run"` values are always created
  and stored by the run root, even when a scenario resolves them; `scope: "scenario"`
  values are created per scenario. Ownership decides disposal: closing a scenario never
  destroys a run-scoped value the next scenario still expects.
- Values are memoised per scope, cycles are detected and reported with the resolution
  chain, and resolving from a closed scope throws `DI_SCOPE_CLOSED` rather than handing
  out a disposed browser.
- `provideInstance()` lets the World attach something it owns (its browser session) so
  consumers still resolve it through the container and it is disposed with the scope. It
  refuses to replace an existing instance, which would leak the previous one undisposed.
- Disposal runs in reverse creation order. **Failures are recorded in
  `disposeErrors` and logged, never thrown** — a teardown artefact must not replace the
  scenario's real result.

## Consequences

- The graph is legible: every edge appears at a `resolve()` call site.
- Around 280 lines instead of a framework dependency, and independently tested (21 unit
  tests cover sharing, memoisation, ordering, cycles, closed scopes and disposal
  failures).
- No implicit request scope or auto-wiring: adding a dependency means writing the
  registration, which is intended.
