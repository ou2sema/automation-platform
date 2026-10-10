import { PlatformError, PlatformErrorCode } from "../errors/index.js";
import type { PlatformLogger } from "../observability/logger.js";
import { getCorrelation, type CorrelationIds } from "../observability/correlation.js";
import type {
  EventEnvelope,
  EventHandler,
  PlatformEventPayload,
  PlatformEventType,
} from "./types.js";

export interface EventBusOptions {
  readonly runId: string;
  readonly logger: PlatformLogger;
  readonly source?: string;
  /**
   * Upper bound on in-flight deliveries. A slow subscriber cannot grow memory
   * without limit; excess events are counted and warned about, never silently
   * mistaken for success.
   */
  readonly maxPending?: number;
  readonly flushTimeoutMs?: number;
}

export interface EventBusStats {
  readonly emitted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly dropped: number;
}

/**
 * Internal storage signature. The map is keyed by event type, so an envelope
 * reaching a handler always matches the type that handler registered for. That
 * invariant is what makes the single cast in `on()` safe at runtime.
 */
type AnyHandler = (envelope: EventEnvelope<PlatformEventType>) => void | Promise<void>;

/**
 * In-process event bus with asynchronous, error-isolated delivery.
 *
 * Guarantees that matter for the roadmap:
 *  - a subscriber that throws or hangs cannot fail the test run;
 *  - delivery is fire-and-forget from the caller's perspective, so the Phase 8
 *    n8n adapter can be attached without ever blocking browser execution;
 *  - `flush()` drains pending work before the process exits.
 */
export class PlatformEventBus {
  private readonly handlers = new Map<PlatformEventType, Set<AnyHandler>>();
  /**
   * In-flight deliveries only. Entries are removed as they settle, so the
   * saturation guard measures real pressure rather than cumulative history;
   * otherwise a long suite would eventually drop every event.
   */
  private readonly pending = new Set<Promise<void>>();
  private emitted = 0;
  private delivered = 0;
  private failed = 0;
  private dropped = 0;
  private closed = false;

  private readonly runId: string;
  private readonly logger: PlatformLogger;
  private readonly source: string;
  private readonly maxPending: number;
  private readonly flushTimeoutMs: number;

  constructor(options: EventBusOptions) {
    this.runId = options.runId;
    this.logger = options.logger;
    this.source = options.source ?? "automation-platform";
    this.maxPending = options.maxPending ?? 5_000;
    this.flushTimeoutMs = options.flushTimeoutMs ?? 5_000;
  }

  /**
   * Subscribe to one event type. Returns an unsubscribe function.
   *
   * The cast in the wrapper is safe because `handlers` is keyed by `type`, so the
   * envelope delivered here was emitted for exactly this event name.
   */
  on<T extends PlatformEventType>(type: T, handler: EventHandler<T>): () => void {
    const wrapped: AnyHandler = (envelope) => handler(envelope as EventEnvelope<T>);
    const set = this.handlers.get(type) ?? new Set<AnyHandler>();
    set.add(wrapped);
    this.handlers.set(type, set);
    return () => {
      set.delete(wrapped);
    };
  }

  /**
   * Enqueue an event. Never throws: an unobservable event is a diagnostics gap,
   * which is recorded, but it must not change the test outcome.
   */
  emit<T extends PlatformEventType>(
    type: T,
    payload: PlatformEventPayload<T>,
    correlation?: CorrelationIds,
  ): void {
    if (this.closed) {
      this.dropped += 1;
      return;
    }

    this.emitted += 1;
    const envelope: EventEnvelope<T> = {
      type,
      payload,
      correlation: correlation ?? getCorrelation() ?? { runId: this.runId },
      emittedAt: new Date().toISOString(),
      source: this.source,
    };

    if (this.pending.size >= this.maxPending) {
      this.dropped += 1;
      this.logger.warn("Event delivery queue is saturated; dropping event.", {
        eventType: type,
        dropped: this.dropped,
      });
      return;
    }

    const delivery = this.dispatch(envelope);
    this.pending.add(delivery);
    const release = (): void => {
      this.pending.delete(delivery);
    };
    void delivery.then(release, release);
  }

  stats(): EventBusStats {
    return {
      emitted: this.emitted,
      delivered: this.delivered,
      failed: this.failed,
      dropped: this.dropped,
    };
  }

  /**
   * Await queued deliveries with a bounded timeout. Late deliveries are logged,
   * not thrown, because the run result is already decided by then.
   */
  async flush(timeoutMs?: number): Promise<void> {
    const limit = timeoutMs ?? this.flushTimeoutMs;
    const inFlight = [...this.pending];
    this.pending.clear();

    const settle = Promise.allSettled(inFlight);
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), limit).unref?.(),
    );

    const result = await Promise.race([settle, timeout]);
    if (result === "timeout") {
      this.logger.warn("Event delivery did not finish before the flush timeout.", {
        pending: inFlight.length,
        timeoutMs: limit,
      });
    }
  }

  async close(): Promise<void> {
    // Closed before draining, so anything emitted during the drain window is
    // counted as dropped instead of queued behind an already-flushed set.
    this.closed = true;
    await this.flush();
  }

  private async dispatch<T extends PlatformEventType>(envelope: EventEnvelope<T>): Promise<void> {
    // Subscriber failures are handled per-handler below, so reaching the outer
    // catch means a platform defect. Recording it keeps a rejected delivery from
    // surfacing as an unhandled rejection.
    try {
      const handlers = this.handlers.get(envelope.type);
      if (handlers === undefined || handlers.size === 0) {
        return;
      }

      for (const handler of handlers) {
        try {
          await handler(envelope);
          this.delivered += 1;
        } catch (cause) {
          this.failed += 1;
          this.logger.errorFrom(cause, "Event subscriber failed; test execution is unaffected.", {
            eventType: envelope.type,
            error:
              cause instanceof PlatformError
                ? { code: cause.code }
                : { code: PlatformErrorCode.EVENT_DELIVERY_FAILED },
          });
        }
      }
    } catch (cause) {
      this.failed += 1;
      this.logger.errorFrom(cause, "Event dispatch failed unexpectedly.", {
        eventType: envelope.type,
      });
    }
  }
}
