/**
 * Public surface of the automation platform.
 *
 * Domain modules and application adapters should import from here rather than
 * reaching into platform internals, so the boundary between "reusable platform" and
 * "application-specific logic" stays enforceable as a second application is added.
 */

// Contracts that Jobs, Services and Page Objects build against.
export type { ExecutionContext } from "./platform/contracts.js";

// Configuration.
export {
  describeConfiguration,
  IMPLEMENTED_CAPABILITIES,
  loadConfiguration,
  readEnvironment,
  type BrowserName,
  type EnvSource,
  type LogLevel,
  type PlatformConfiguration,
  type RecoveryMode,
} from "./platform/configuration/index.js";

// Errors.
export {
  AssertionFailedError,
  BrowserLifecycleError,
  ConfigurationError,
  isPlatformError,
  PlatformError,
  PlatformErrorCode,
  toErrorReport,
  type ErrorReport,
  type ErrorSeverity,
  type PlatformErrorOptions,
} from "./platform/errors/index.js";

// Observability.
export {
  createId,
  createLogger,
  createLoggerWithSink,
  createRunId,
  getCorrelation,
  MemorySink,
  mergeCorrelation,
  runWithin,
  withCorrelation,
  withRootCorrelation,
  type CorrelationIds,
  type CorrelationOverlay,
  type LogContext,
  type LogSink,
  type PlatformLogger,
} from "./platform/observability/index.js";

// Events.
export {
  PlatformEventBus,
  type EventBusOptions,
  type EventBusStats,
  type EventEnvelope,
  type EventHandler,
  type PlatformEventMap,
  type PlatformEventType,
  type ScenarioResultStatus,
} from "./platform/events/index.js";

// Dependency injection.
export {
  createToken,
  DependencyContainer,
  type Disposable,
  type ResolutionScope,
  type ScopeKind,
  type Token,
} from "./platform/dependency-injection/index.js";

// Timing.
export { withTimeout } from "./platform/timing/index.js";

// Browser lifecycle.
export {
  BrowserManager,
  BrowserSession,
  type ArtifactKind,
  type ArtifactRecord,
  type IBrowserSession,
  type SessionCloseResult,
} from "./platform/browser/index.js";

// Cucumber runtime.
export { PlatformWorld, type PlatformWorldParameters } from "./platform/cucumber/index.js";
export {
  hasRunContext,
  initializeRun,
  requireRunContext,
  resetRunContextForTesting,
  shutdownRun,
  type RunContext,
} from "./platform/runtime/index.js";

// Tokens.
export {
  BrowserManagerToken,
  BrowserSessionToken,
  ConfigurationToken,
  EventBusToken,
  LoggerToken,
} from "./platform/tokens.js";
