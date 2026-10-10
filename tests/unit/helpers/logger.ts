import {
  MemorySink,
  createLoggerWithSink,
  type LogLevel,
  type PlatformLogger,
} from "../../../src/index.js";
import type { CorrelationIds } from "../../../src/index.js";

export interface TestLogger {
  readonly logger: PlatformLogger;
  readonly sink: MemorySink;
}

export function makeTestLogger(
  options: {
    readonly level?: LogLevel;
    readonly staticCorrelation?: CorrelationIds;
  } = {},
): TestLogger {
  const sink = new MemorySink();
  return {
    sink,
    logger: createLoggerWithSink(sink, {
      level: options.level ?? "debug",
      ...(options.staticCorrelation === undefined
        ? {}
        : { staticCorrelation: options.staticCorrelation }),
    }),
  };
}
