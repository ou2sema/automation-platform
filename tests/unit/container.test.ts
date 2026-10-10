import { beforeEach, describe, expect, it } from "vitest";

import {
  createToken,
  DependencyContainer,
  isPlatformError,
  PlatformErrorCode,
  type Disposable,
  type PlatformError,
  type ResolutionScope,
} from "../../src/index.js";

import { makeTestLogger } from "./helpers/logger.js";

interface Service {
  readonly label: string;
  dispose(): void;
}

function makeService(tracker: string[], label: string): Service {
  return {
    label,
    dispose: () => {
      tracker.push(`dispose-${label}`);
    },
  };
}

/**
 * Turns a rejected operation into its `PlatformError`, so assertions can read the
 * code and structured context, and a missing rejection fails loudly instead of
 * passing silently.
 */
async function expectPlatformError<T>(
  operation: Promise<T>,
  code: PlatformErrorCode,
): Promise<PlatformError> {
  const failure = await operation.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (!isPlatformError(failure)) {
    throw new Error(`Expected a ${code} PlatformError, got: ${String(failure)}`);
  }
  expect(failure.code).toBe(code);
  return failure;
}

const ServiceToken = createToken<Service>("service");
const OtherToken = createToken<Service>("other");
const RunnerToken = createToken<{ name: string }>("runner");
const ScenarioToken = createToken<{ name: string }>("scenario-only");

describe("DependencyContainer registration", () => {
  it("refuses a second registration for the same token", () => {
    const container = new DependencyContainer();
    container.register(ServiceToken, () => makeService([], "first"));

    expect(() => container.register(ServiceToken, () => makeService([], "second"))).toThrow(
      /already registered/,
    );
  });

  it("reports which tokens exist when a lookup misses", async () => {
    const container = new DependencyContainer();
    const missing = createToken<string>("missing");
    container.register(RunnerToken, () => ({ name: "runner" }));
    const scope = container.createRunScope();

    const failure = await expectPlatformError(
      scope.resolve(missing),
      PlatformErrorCode.DI_TOKEN_NOT_REGISTERED,
    );
    expect(failure.context.registered).toEqual(["runner"]);
    expect(failure.context.scopeKind).toBe("run");
  });

  it("lists registrations for tooling and diagnostics", () => {
    const container = new DependencyContainer();
    expect(container.isRegistered(ServiceToken.name)).toBe(false);
    container.register(ServiceToken, () => makeService([], "service"));
    expect(container.isRegistered(ServiceToken.name)).toBe(true);
    expect(container.registeredTokens()).toEqual(["service"]);
  });
});

describe("DependencyContainer scoping", () => {
  let container: DependencyContainer;
  let scenarioCreations = 0;

  beforeEach(() => {
    scenarioCreations = 0;
    container = new DependencyContainer();
    container.register(RunnerToken, () => ({ name: "shared runner" }), { scope: "run" });
    container.register(ScenarioToken, () => {
      scenarioCreations += 1;
      return { name: `scenario ${scenarioCreations}` };
    });
  });

  it("shares a run-scoped value across every scenario scope", async () => {
    const run = container.createRunScope();
    const first = container.createScenarioScope(run);
    const second = container.createScenarioScope(run);

    const fromRun = await run.resolve(RunnerToken);
    expect(await first.resolve(RunnerToken)).toBe(fromRun);
    expect(await second.resolve(RunnerToken)).toBe(fromRun);
  });

  it("gives each scenario its own scenario-scoped value", async () => {
    const run = container.createRunScope();
    const first = container.createScenarioScope(run);
    const second = container.createScenarioScope(run);

    expect(await first.resolve(ScenarioToken)).not.toBe(await second.resolve(ScenarioToken));
    expect(scenarioCreations).toBe(2);
  });

  it("creates a value once per scope, not once per resolve", async () => {
    let creations = 0;
    const local = new DependencyContainer();
    local.register(ServiceToken, () => {
      creations += 1;
      return makeService([], `service-${creations}`);
    });
    const scope = local.createRunScope();

    const a = await scope.resolve(ServiceToken);
    const b = await scope.resolve(ServiceToken);

    expect(creations).toBe(1);
    expect(a).toBe(b);
  });

  it("reuses a run-scoped instance even when only scenario scopes asked for it", async () => {
    let creations = 0;
    const local = new DependencyContainer();
    local.register(
      RunnerToken,
      () => {
        creations += 1;
        return { name: `runner ${creations}` };
      },
      { scope: "run" },
    );

    const run = local.createRunScope();
    const first = local.createScenarioScope(run);
    const second = local.createScenarioScope(run);

    await first.resolve(RunnerToken);
    await second.resolve(RunnerToken);

    expect(creations).toBe(1);
  });

  it("keeps ownership of a run-scoped value with the run scope", async () => {
    const tracker: string[] = [];
    const local = new DependencyContainer();
    local.register(ServiceToken, () => makeService(tracker, "run-owned"), { scope: "run" });

    const run = local.createRunScope();
    const scenario = local.createScenarioScope(run);
    const shared = await scenario.resolve(ServiceToken);

    // Closing a scenario must not destroy a value the next scenario still expects.
    await scenario.dispose();
    expect(tracker).toEqual([]);

    expect(await run.resolve(ServiceToken)).toBe(shared);
    await run.dispose();
    expect(tracker).toEqual(["dispose-run-owned"]);
  });

  it("rejects a scenario scope built on another scenario", () => {
    const run = container.createRunScope();
    const first = container.createScenarioScope(run);

    expect(() => container.createScenarioScope(first)).toThrow(/children of the run scope/);
  });

  it("rejects a foreign scope object", () => {
    const impostor = { id: "fake", kind: "run" } as unknown as ResolutionScope;
    expect(() => container.createScenarioScope(impostor)).toThrow(/produced by createRunScope/);
  });
});

describe("DependencyContainer instances and cycles", () => {
  it("attaches an externally owned instance and disposes it with the scope", async () => {
    const container = new DependencyContainer();
    container.register(ServiceToken, () => makeService([], "from-factory"));
    const scope = container.createRunScope();
    const tracker: string[] = [];

    scope.provideInstance(ServiceToken, makeService(tracker, "from-world"));

    expect((await scope.resolve(ServiceToken)).label).toBe("from-world");
    await scope.dispose();
    expect(tracker).toEqual(["dispose-from-world"]);
  });

  it("refuses to replace an instance, which would leak the previous one", () => {
    const container = new DependencyContainer();
    const scope = container.createRunScope();
    scope.provideInstance(ServiceToken, makeService([], "first"));

    expect(() => scope.provideInstance(ServiceToken, makeService([], "second"))).toThrow(
      /without disposing it/,
    );
  });

  it("detects a dependency cycle instead of recursing forever", async () => {
    const a = createToken<{ b: unknown }>("a");
    const b = createToken<{ a: unknown }>("b");
    const container = new DependencyContainer();
    container.register(a, async (scope) => ({ b: await scope.resolve(b) }));
    container.register(b, async (scope) => ({ a: await scope.resolve(a) }));

    const failure = await expectPlatformError(
      container.createRunScope().resolve(a),
      PlatformErrorCode.DI_RESOLUTION_FAILED,
    );
    expect(failure.context.chain).toEqual(["a", "b", "a"]);
  });

  it("returns undefined from tryResolve for an unknown token", async () => {
    const container = new DependencyContainer();
    container.register(RunnerToken, () => ({ name: "runner" }));
    const scope = container.createRunScope();

    expect(await scope.tryResolve(RunnerToken)).toEqual({ name: "runner" });
    expect(await scope.tryResolve(createToken<string>("absent"))).toBeUndefined();
  });

  it("resolves a provided instance through tryResolve without a registration", async () => {
    const container = new DependencyContainer();
    const scope = container.createRunScope();
    const late = createToken<{ name: string }>("late");
    scope.provideInstance(late, { name: "provided" });

    expect(await scope.tryResolve(late)).toEqual({ name: "provided" });
  });
});

describe("DependencyContainer disposal", () => {
  it("disposes in reverse creation order", async () => {
    const tracker: string[] = [];
    const container = new DependencyContainer();
    container.register(ServiceToken, () => makeService(tracker, "first"));
    container.register(OtherToken, () => makeService(tracker, "second"));

    const scope = container.createRunScope();
    await scope.resolve(ServiceToken);
    await scope.resolve(OtherToken);
    await scope.dispose();

    expect(tracker).toEqual(["dispose-second", "dispose-first"]);
  });

  it("records disposal failures instead of throwing over the test result", async () => {
    const { logger, sink } = makeTestLogger();
    const container = new DependencyContainer({ logger });
    const broken = createToken<Disposable>("broken");
    container.register(broken, () => ({
      dispose: () => {
        throw new Error("teardown exploded");
      },
    }));

    const scope = container.createRunScope();
    await scope.resolve(broken);

    await expect(scope.dispose()).resolves.toBeUndefined();

    expect(scope.disposeErrors).toHaveLength(1);
    expect(scope.disposeErrors[0]?.code).toBe(PlatformErrorCode.DI_RESOLUTION_FAILED);
    expect(sink.find("Resource disposal failed")?.level).toBe("error");
  });

  it("disposes scenario values before run values", async () => {
    const tracker: string[] = [];
    const container = new DependencyContainer();
    container.register(
      RunnerToken,
      () => ({ name: "runner", dispose: () => tracker.push("run") }),
      { scope: "run" },
    );
    container.register(ScenarioToken, () => ({
      name: "scenario value",
      dispose: () => tracker.push("scenario"),
    }));

    const run = container.createRunScope();
    const scenario = container.createScenarioScope(run);
    await run.resolve(RunnerToken);
    await scenario.resolve(ScenarioToken);

    await scenario.dispose();
    expect(tracker).toEqual(["scenario"]);
    await run.dispose();
    expect(tracker).toEqual(["scenario", "run"]);
  });

  it("refuses resolution from a closed scope", async () => {
    const container = new DependencyContainer();
    container.register(RunnerToken, () => ({ name: "runner" }));
    const scope = container.createRunScope();
    await scope.dispose();

    await expectPlatformError(scope.resolve(RunnerToken), PlatformErrorCode.DI_SCOPE_CLOSED);
  });

  it("is safe to dispose twice", async () => {
    const tracker: string[] = [];
    const container = new DependencyContainer();
    container.register(ServiceToken, () => makeService(tracker, "single"));
    const scope = container.createRunScope();
    await scope.resolve(ServiceToken);

    await scope.dispose();
    await scope.dispose();

    expect(tracker).toEqual(["dispose-single"]);
  });

  it("skips values that are not disposable", async () => {
    const container = new DependencyContainer();
    container.register(RunnerToken, () => ({ name: "plain value" }));
    const scope = container.createRunScope();
    await scope.resolve(RunnerToken);

    await expect(scope.dispose()).resolves.toBeUndefined();
    expect(scope.disposeErrors).toEqual([]);
  });
});
