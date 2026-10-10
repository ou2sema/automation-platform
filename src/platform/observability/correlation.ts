import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Correlation chain required by the observability design:
 *
 *   runId -> scenarioId -> jobId -> actionId -> recoveryAttemptId
 *
 * Each identifier is introduced by the code that owns that execution boundary.
 */
export interface CorrelationIds {
  readonly runId: string;
  readonly scenarioId?: string;
  readonly scenarioName?: string;
  readonly jobId?: string;
  readonly actionId?: string;
  readonly recoveryAttemptId?: string;
}

/** Overlay accepted when entering a nested boundary. */
export type CorrelationOverlay = Partial<CorrelationIds>;

const storage = new AsyncLocalStorage<CorrelationIds>();

export function createId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export function createRunId(label?: string): string {
  const suffix = label === undefined || label.length === 0 ? "" : `-${slugify(label)}`;
  return `run${suffix}-${createId("x").slice(2)}`;
}

/**
 * Current correlation for this async execution, or `undefined` when no boundary
 * has been established. Callers must tolerate `undefined`: a missing correlation
 * is a diagnostics gap, never a reason to fail automation.
 */
export function getCorrelation(): CorrelationIds | undefined {
  return storage.getStore();
}

/**
 * Run `body` with `overlay` merged onto the current correlation.
 *
 * Scope note: Cucumber invokes each step in its own async context, so this
 * function is NOT relied upon to carry scenario identity between steps. Scenario
 * scope lives on the World instance; this mechanism establishes finer-grained
 * job and action spans *around* the work they start, where async propagation does
 * hold. See docs/architecture/ADR-0008.
 */
export async function withCorrelation<T>(
  overlay: CorrelationOverlay,
  body: () => Promise<T> | T,
): Promise<T> {
  return storage.run(mergeCorrelation(storage.getStore(), overlay), () => body());
}

export function mergeCorrelation(
  base: CorrelationIds | undefined,
  overlay: CorrelationOverlay,
): CorrelationIds {
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  if (merged.runId === undefined) {
    throw new Error(
      "Correlation requires runId. Run this inside an initialized run, or pass a base correlation that carries one.",
    );
  }
  return merged as unknown as CorrelationIds;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

/**
 * Establish a nested boundary *from an explicit base* rather than from ambient
 * storage.
 *
 * This is the form Jobs and Services use: a Cucumber step runs in its own async
 * context, so ambient storage is empty at the point a Job starts. The Job already
 * receives the scenario's correlation through `ExecutionContext`, so it seeds the
 * span from that and the chain (runId -> scenarioId -> jobId) is preserved.
 */
export async function runWithin<T>(
  base: CorrelationIds,
  overlay: CorrelationOverlay,
  body: () => Promise<T> | T,
): Promise<T> {
  return storage.run(mergeCorrelation(base, overlay), () => body());
}

/** Test seam: run a body with an explicitly injected root correlation. */
export async function withRootCorrelation<T>(
  root: CorrelationIds,
  body: () => Promise<T> | T,
): Promise<T> {
  return storage.run(root, () => body());
}
