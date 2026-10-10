/**
 * Standardised error taxonomy for the platform.
 *
 * Only codes that currently have a producer are declared. Phase 4 adds
 * recovery-specific codes rather than overloading these ones.
 */
export const PlatformErrorCode = {
  CONFIGURATION_INVALID: "CONFIGURATION_INVALID",
  FIXTURE_NOT_FOUND: "FIXTURE_NOT_FOUND",

  BROWSER_LAUNCH_FAILED: "BROWSER_LAUNCH_FAILED",
  BROWSER_NOT_AVAILABLE: "BROWSER_NOT_AVAILABLE",
  BROWSER_CONTEXT_FAILED: "BROWSER_CONTEXT_FAILED",
  BROWSER_CLOSE_FAILED: "BROWSER_CLOSE_FAILED",

  NAVIGATION_FAILED: "NAVIGATION_FAILED",

  /**
   * UI interaction failures. Kept distinct from assertion failures because Phase 4
   * must be able to tell "the page did not have what we expected" apart from
   * "the page said something we did not want".
   */
  ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
  ELEMENT_AMBIGUOUS: "ELEMENT_AMBIGUOUS",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",

  OPERATION_TIMEOUT: "OPERATION_TIMEOUT",

  DI_TOKEN_NOT_REGISTERED: "DI_TOKEN_NOT_REGISTERED",
  DI_SCOPE_CLOSED: "DI_SCOPE_CLOSED",
  DI_RESOLUTION_FAILED: "DI_RESOLUTION_FAILED",

  EVENT_DELIVERY_FAILED: "EVENT_DELIVERY_FAILED",

  ASSERTION_FAILED: "ASSERTION_FAILED",

  /** A domain rule stopped an action before it could reach the application. */
  BUSINESS_RULE_VIOLATED: "BUSINESS_RULE_VIOLATED",

  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type PlatformErrorCode = (typeof PlatformErrorCode)[keyof typeof PlatformErrorCode];

export type ErrorSeverity = "informational" | "warning" | "critical";

export interface PlatformErrorOptions {
  readonly severity?: ErrorSeverity;
  readonly retryable?: boolean;
  readonly cause?: unknown;
  /**
   * Structured, diagnostic-only context. Never place secrets or raw form values
   * here: context is serialised into logs and reports.
   */
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * Serializable shape used by logging, reporting and (later) n8n event payloads.
 */
export interface ErrorReport {
  readonly name: string;
  readonly code: PlatformErrorCode;
  readonly message: string;
  readonly severity: ErrorSeverity;
  readonly retryable: boolean;
  readonly stack?: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly cause?: ErrorReport;
}

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly severity: ErrorSeverity;
  readonly retryable: boolean;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: PlatformErrorCode, message: string, options: PlatformErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.severity = options.severity ?? "critical";
    this.retryable = options.retryable ?? false;
    this.context = options.context ?? {};
  }

  toReport(): ErrorReport {
    return toErrorReport(this);
  }
}

export function isPlatformError(value: unknown): value is PlatformError {
  return value instanceof PlatformError;
}

/**
 * Convert any thrown value into a report without losing the original error.
 * Unknown values become `UNKNOWN_ERROR` instead of being silently dropped.
 *
 * Cause chains are walked with cycle detection, so an error graph that loops still
 * produces a report instead of exhausting the stack while serialising it.
 */
export function toErrorReport(value: unknown): ErrorReport {
  // The root is already being reported, so a cause that points back at it is a
  // cycle on the first hop rather than a second, deeper copy of the same error.
  const seen = new Set<unknown>();
  if (value instanceof Error) {
    seen.add(value);
  }
  return buildReport(value, seen);
}

const CIRCULAR_MARKER = "[circular reference in cause chain]";

function buildReport(value: unknown, seen: Set<unknown>): ErrorReport {
  if (isPlatformError(value)) {
    return {
      name: value.name,
      code: value.code,
      message: value.message,
      severity: value.severity,
      retryable: value.retryable,
      context: value.context,
      ...(value.stack === undefined ? {} : { stack: value.stack }),
      ...(value.cause === undefined ? {} : { cause: describeCause(value.cause, seen) }),
    };
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      code: PlatformErrorCode.UNKNOWN_ERROR,
      message: value.message,
      severity: "critical",
      retryable: false,
      context: {},
      ...(value.stack === undefined ? {} : { stack: value.stack }),
      ...(value.cause === undefined ? {} : { cause: describeCause(value.cause, seen) }),
    };
  }

  return {
    name: "NonThrownValue",
    code: PlatformErrorCode.UNKNOWN_ERROR,
    message: `A non-Error value was thrown: ${describeUnknown(value)}`,
    severity: "critical",
    retryable: false,
    context: { thrownType: typeof value },
  };
}

function describeCause(cause: unknown, seen: Set<unknown>): ErrorReport {
  if (cause instanceof Error) {
    if (seen.has(cause)) {
      return {
        name: cause.name,
        code: PlatformErrorCode.UNKNOWN_ERROR,
        message: CIRCULAR_MARKER,
        severity: "warning",
        retryable: false,
        context: { circular: true },
      };
    }
    seen.add(cause);
  }
  return buildReport(cause, seen);
}

function describeUnknown(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return String(value);
  }
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
  return name === undefined ? "object (no prototype)" : `[${name}]`;
}

export class ConfigurationError extends PlatformError {
  constructor(message: string, options: PlatformErrorOptions = {}) {
    super(PlatformErrorCode.CONFIGURATION_INVALID, message, {
      severity: "critical",
      ...options,
    });
  }
}

export class BrowserLifecycleError extends PlatformError {
  constructor(code: PlatformErrorCode, message: string, options: PlatformErrorOptions = {}) {
    super(code, message, { severity: "critical", ...options });
  }
}

export class AssertionFailedError extends PlatformError {
  constructor(message: string, options: PlatformErrorOptions = {}) {
    super(PlatformErrorCode.ASSERTION_FAILED, message, {
      severity: "critical",
      ...options,
    });
  }
}

/**
 * Raised when a business rule makes an action impossible. Severity is a warning and the
 * operation is never retryable: replaying a blocked action cannot make it legal, and a
 * blind retry of a non-idempotent action is exactly what this class prevents.
 */
export class BusinessRuleError extends PlatformError {
  constructor(message: string, options: PlatformErrorOptions = {}) {
    super(PlatformErrorCode.BUSINESS_RULE_VIOLATED, message, {
      severity: "warning",
      retryable: false,
      ...options,
    });
  }
}
