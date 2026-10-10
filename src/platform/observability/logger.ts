import type { Writable } from "node:stream";

import pino, { type Logger as PinoLogger } from "pino";

import { SENSITIVE_CONFIG_PATHS, type PlatformConfiguration } from "../configuration/index.js";
import type { LogLevel } from "../configuration/schema.js";
import { toErrorReport } from "../errors/index.js";
import { getCorrelation, type CorrelationIds } from "./correlation.js";

export type LogContext = Readonly<Record<string, unknown>>;

/**
 * Structured logger.
 *
 * Correlation is merged from two sources at emit time:
 *  - `staticCorrelation`, bound at creation (run and scenario identity). This is
 *    required because Cucumber invokes each step in its own async context, so
 *    async-local storage alone would lose scenario scope between steps.
 *  - the async-local store, which carries the finer job / action / recovery span
 *    around the work those boundaries start.
 *
 * Redaction is applied by the transport, so a secret cannot escape through a
 * context object even when a caller forgets.
 */
export interface PlatformLogger {
  readonly level: LogLevel;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
  child(bindings: LogContext): PlatformLogger;
  /** Log any thrown value, normalised into the standard error report. */
  errorFrom(cause: unknown, message: string, context?: LogContext): void;
}

/** Destination abstraction so tests can assert on records without touching stdout. */
export interface LogSink {
  write(level: LogLevel, record: LogContext, message: string): void;
}

interface EmitterOptions {
  readonly sink: LogSink;
  readonly minLevel: LogLevel;
  readonly bindings: LogContext;
  readonly staticCorrelation: LogContext;
}

const LEVELS: readonly LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

function rank(level: LogLevel): number {
  return LEVELS.indexOf(level);
}

export function createLogger(
  config: PlatformConfiguration,
  staticCorrelation?: CorrelationIds,
  destination?: Writable,
): PlatformLogger {
  // The destination is injectable so the redaction guarantee can be tested against
  // real pino output; an in-memory sink would not exercise the transport at all.
  const instance: PinoLogger = pino(
    {
      level: config.logging.level,
      base: { runLabel: config.run.label },
      redact: { paths: [...SENSITIVE_CONFIG_PATHS], censor: "[REDACTED]" },
      timestamp: pino.stdTimeFunctions.isoTime,
      ...(config.logging.pretty
        ? {
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "HH:MM:ss.l",
                ignore: "pid,hostname,runLabel",
              },
            },
          }
        : {}),
    },
    destination,
  );

  return createEmitter({
    sink: {
      write: (level, record, message) => {
        instance[level](record, message);
      },
    },
    minLevel: config.logging.level,
    bindings: {},
    staticCorrelation: toContext(staticCorrelation),
  });
}

export function createLoggerWithSink(
  sink: LogSink,
  options: {
    readonly level?: LogLevel;
    readonly staticCorrelation?: CorrelationIds;
    readonly bindings?: LogContext;
  } = {},
): PlatformLogger {
  return createEmitter({
    sink,
    minLevel: options.level ?? "info",
    bindings: options.bindings ?? {},
    staticCorrelation: toContext(options.staticCorrelation),
  });
}

function createEmitter(options: EmitterOptions): PlatformLogger {
  const emit = (level: LogLevel, message: string, context?: LogContext): void => {
    if (rank(level) < rank(options.minLevel)) {
      return;
    }
    const record: LogContext = {
      ...options.bindings,
      ...context,
      ...options.staticCorrelation,
      ...(getCorrelation() ?? {}),
    };
    options.sink.write(level, record, message);
  };

  const logger: PlatformLogger = {
    level: options.minLevel,
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
    fatal: (message, context) => emit("fatal", message, context),
    child: (bindings) =>
      createEmitter({
        ...options,
        bindings: { ...options.bindings, ...bindings },
      }),
    errorFrom: (cause, message, context) =>
      emit("error", message, { ...context, error: toErrorReport(cause) }),
  };

  return logger;
}

function toContext(correlation: CorrelationIds | undefined): LogContext {
  return correlation === undefined ? {} : { ...correlation };
}

export interface LoggedRecord {
  readonly level: LogLevel;
  readonly record: LogContext;
  readonly message: string;
}

/** Collects records in memory. Used by framework self-tests. */
export class MemorySink implements LogSink {
  readonly records: LoggedRecord[] = [];

  write(level: LogLevel, record: LogContext, message: string): void {
    this.records.push({ level, record, message });
  }

  find(messageFragment: string): LoggedRecord | undefined {
    return this.records.find((item) => item.message.includes(messageFragment));
  }
}
