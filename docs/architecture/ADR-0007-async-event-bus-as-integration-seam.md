# ADR-0007 — an in-process async event bus is the integration seam

Status: accepted (Phase 1)

## Context

Phase 7 (observability) and Phase 8 (n8n) both need to react to what happened during a
scenario, and the brief is explicit that an external call must never sit inside the
browser interaction loop. If code starts calling a webhook client from a hook, then a
slow or unreachable n8n instance changes how long interactions take and eventually
changes test results. That is the failure mode this decision exists to prevent.

## Decision

`src/platform/events/`:

- `types.ts` declares `PlatformEventMap`, a catalogue keyed by event name with a payload
  type per entry. Adding a Phase 4-8 recovery event means adding a map entry, not
  widening a loose payload. Payloads carry diagnostics only — never secrets, never raw
  form values, never a DOM snapshot.
- `bus.ts` implements `PlatformEventBus`: subscription is per event type, delivery is
  **asynchronous and fire-and-forget from the caller's perspective**, and every
  subscriber invocation is wrapped so a throw or rejection is counted as a failed
  delivery and logged. `emit()` never throws.
- A bounded in-flight queue (`maxPending`, default 5 000) counts and warns on drops
  rather than growing memory without limit. The queue holds **in-flight work only** and
  prunes as deliveries settle, so saturation means real pressure, not cumulative
  history — otherwise a long suite would end up discarding every event.
- `flush(timeoutMs)` is raced against a bounded timer, and `close()` marks the bus closed
  _before_ draining so nothing is queued behind an already-flushed set. Late deliveries
  are logged, never thrown: the run outcome is already decided by then.
- The envelope stamps `correlation` at emit time, so a handler that runs after the job
  span has closed still reports the identifiers of the work that produced the event.

## Consequences

- The Phase 8 n8n adapter is a subscriber. It cannot block the browser loop, cannot fail
  a scenario, and cannot be reached at all without going through this bus.
- Event delivery is best-effort by design. The counts (`emitted`, `delivered`, `failed`,
  `dropped`) are logged at the end of a run so a diagnostics gap is visible instead of
  silent — a dropped event is a reporting problem, never a passing test.
- Everything that needs to happen _synchronously_ to a scenario (attaching a screenshot,
  recording a result) stays in the Cucumber hooks. The bus is for observers.
- Seventeen bus tests cover isolation, ordering, unsubscribe, correlation snapshotting,
  saturation-then-recovery, flush timeout and close semantics.
