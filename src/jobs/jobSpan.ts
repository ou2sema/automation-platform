import type { ExecutionContext } from "../platform/contracts.js";
import { createId, runWithin } from "../platform/observability/correlation.js";

/**
 * Open the job span for one unit of business work.
 *
 * Every Job must run inside this span, otherwise its logs and (from Phase 7) its events
 * cannot be attributed to a unit of work: the chain is
 * `runId -> scenarioId -> jobId`, and the Job is the only place `jobId` is born.
 *
 * The span is seeded from `ExecutionContext.correlation` rather than from ambient storage
 * because a Cucumber step runs in its own async context. See ADR-0008.
 */
export function withinJobSpan<T>(context: ExecutionContext, body: () => Promise<T>): Promise<T> {
  return runWithin(context.correlation, { jobId: createId("job") }, body);
}
