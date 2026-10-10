import { PlatformError, PlatformErrorCode } from "../errors/index.js";
import type { PlatformLogger } from "../observability/logger.js";
import { createId } from "../observability/correlation.js";

/**
 * A deliberately small, dependency-free inversion container.
 *
 * Why not decorators from an IoC framework: decorators need experimental compiler
 * flags, and a reflection-based container hides dependencies behind magic. The
 * roadmap asks for "dependency injection or a lightweight scenario-scoped
 * composition mechanism" with explicit dependencies, so tokens are declared where
 * they are consumed and every edge is visible.
 */
export interface Token<T> {
  readonly name: string;
  /** Phantom field: never assigned, exists only to carry `T` in the type system. */
  readonly consumes?: (value: T) => T;
}

export function createToken<T>(name: string): Token<T> {
  return { name };
}

export type ScopeKind = "run" | "scenario";

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface ResolutionScope {
  readonly id: string;
  readonly kind: ScopeKind;
  resolve<T>(token: Token<T>): Promise<T>;
  /** Try a lookup without throwing when the token is not registered. */
  tryResolve<T>(token: Token<T>): Promise<T | undefined>;
  /**
   * Attach an already-constructed value to this scope. Used when ownership of the
   * value belongs to the scope itself (for example a scenario's browser session,
   * which only the World knows the correlation of) but consumers should still
   * resolve it through the container and be disposed with it.
   */
  provideInstance<T>(token: Token<T>, value: T): void;
  dispose(): Promise<void>;
  readonly disposeErrors: readonly PlatformError[];
}

type AnyFactory = (scope: ResolutionScope) => unknown;

interface Registration {
  readonly factory: AnyFactory;
  readonly scope: ScopeKind;
}

export interface ContainerOptions {
  readonly logger?: PlatformLogger;
}

export class DependencyContainer {
  private readonly registrations = new Map<string, Registration>();
  private readonly logger: PlatformLogger | undefined;

  constructor(options: ContainerOptions = {}) {
    this.logger = options.logger;
  }

  register<T>(
    token: Token<T>,
    factory: (scope: ResolutionScope) => T | Promise<T>,
    options: { readonly scope?: ScopeKind } = {},
  ): this {
    if (this.registrations.has(token.name)) {
      throw new PlatformError(
        PlatformErrorCode.DI_RESOLUTION_FAILED,
        `Token "${token.name}" is already registered. Re-registering would silently change behaviour for consumers that resolved earlier.`,
        { context: { token: token.name } },
      );
    }
    this.registrations.set(token.name, {
      factory,
      scope: options.scope ?? "scenario",
    });
    return this;
  }

  isRegistered(tokenName: string): boolean {
    return this.registrations.has(tokenName);
  }

  registeredTokens(): readonly string[] {
    return [...this.registrations.keys()];
  }

  createRunScope(): ResolutionScope {
    return new Scope(this, createId("runscope"), "run", undefined);
  }

  createScenarioScope(run: ResolutionScope): ResolutionScope {
    if (!(run instanceof Scope)) {
      throw new PlatformError(
        PlatformErrorCode.DI_RESOLUTION_FAILED,
        "createScenarioScope requires a scope produced by createRunScope().",
        { context: { received: run.kind } },
      );
    }
    if (run.kind !== "run") {
      throw new PlatformError(
        PlatformErrorCode.DI_RESOLUTION_FAILED,
        "Scenario scopes must be children of the run scope, never of another scenario.",
        { context: { parentKind: run.kind, parentId: run.id } },
      );
    }
    return new Scope(this, createId("scenscope"), "scenario", run);
  }

  /** @internal */
  find(tokenName: string): Registration | undefined {
    return this.registrations.get(tokenName);
  }

  /** @internal */
  logDisposalFailure(error: PlatformError): void {
    if (this.logger === undefined) {
      return;
    }
    this.logger.errorFrom(error, "Resource disposal failed.");
  }
}

class Scope implements ResolutionScope {
  readonly id: string;
  readonly kind: ScopeKind;

  private readonly instances = new Map<string, unknown>();
  private readonly creationOrder: string[] = [];
  private readonly resolving = new Set<string>();
  private readonly parent: Scope | undefined;
  private readonly container: DependencyContainer;
  private closed = false;

  disposalErrors: PlatformError[] = [];

  constructor(container: DependencyContainer, id: string, kind: ScopeKind, parent?: Scope) {
    this.container = container;
    this.id = id;
    this.kind = kind;
    this.parent = parent;
  }

  get disposeErrors(): readonly PlatformError[] {
    return this.disposalErrors;
  }

  async resolve<T>(token: Token<T>): Promise<T> {
    this.assertOpen();

    if (this.instances.has(token.name)) {
      return this.instances.get(token.name) as T;
    }

    const registration = this.container.find(token.name);
    if (registration === undefined) {
      throw new PlatformError(
        PlatformErrorCode.DI_TOKEN_NOT_REGISTERED,
        `No factory is registered for token "${token.name}".`,
        {
          context: {
            token: token.name,
            scopeKind: this.kind,
            registered: this.container.registeredTokens(),
          },
        },
      );
    }

    // A run-scoped value is always owned by the run scope, even when a scenario
    // scope asks for it, so sharing is explicit rather than accidental. Ownership
    // also decides disposal: closing a scenario must not destroy a value the next
    // scenario still expects to find.
    const owner = registration.scope === "run" ? this.runRoot() : this;

    if (owner.instances.has(token.name)) {
      return owner.instances.get(token.name) as T;
    }

    if (owner.resolving.has(token.name)) {
      throw new PlatformError(
        PlatformErrorCode.DI_RESOLUTION_FAILED,
        `Dependency cycle detected while resolving "${token.name}".`,
        { context: { token: token.name, chain: [...owner.resolving, token.name] } },
      );
    }

    owner.resolving.add(token.name);
    try {
      const value = await registration.factory(owner);
      owner.instances.set(token.name, value);
      owner.creationOrder.push(token.name);
      return value as T;
    } finally {
      owner.resolving.delete(token.name);
    }
  }

  async tryResolve<T>(token: Token<T>): Promise<T | undefined> {
    if (!this.container.isRegistered(token.name) && !this.instances.has(token.name)) {
      return undefined;
    }
    return this.resolve(token);
  }

  provideInstance<T>(token: Token<T>, value: T): void {
    this.assertOpen();
    if (this.instances.has(token.name)) {
      throw new PlatformError(
        PlatformErrorCode.DI_RESOLUTION_FAILED,
        `Token "${token.name}" already has an instance in the ${this.kind} scope ${this.id}. Replacing it would leak the previous instance without disposing it.`,
        { context: { token: token.name, scopeId: this.id } },
      );
    }
    this.instances.set(token.name, value);
    this.creationOrder.push(token.name);
  }

  async dispose(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    for (const tokenName of [...this.creationOrder].reverse()) {
      const value = this.instances.get(tokenName);
      this.instances.delete(tokenName);
      if (value === undefined || value === null || typeof value !== "object") {
        continue;
      }
      if (!isDisposable(value)) {
        continue;
      }
      try {
        await value.dispose();
      } catch (cause) {
        const error =
          cause instanceof PlatformError
            ? cause
            : new PlatformError(
                PlatformErrorCode.DI_RESOLUTION_FAILED,
                `Disposing "${tokenName}" threw.`,
                { cause, context: { token: tokenName } },
              );
        // Disposal problems are recorded and logged, never thrown: they must not
        // replace the real scenario result with a teardown artefact.
        this.disposalErrors.push(error);
        this.container.logDisposalFailure(error);
      }
    }
    this.creationOrder.length = 0;
  }

  private runRoot(): Scope {
    if (this.kind === "run" || this.parent === undefined) {
      return this;
    }
    return this.parent.runRoot();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new PlatformError(
        PlatformErrorCode.DI_SCOPE_CLOSED,
        `Attempted to resolve from the already-closed ${this.kind} scope ${this.id}. A closed scope usually means work continued after the scenario finished.`,
        { context: { scopeId: this.id, scopeKind: this.kind } },
      );
    }
  }
}

function isDisposable(value: object): value is Disposable {
  return typeof (value as Disposable).dispose === "function";
}
