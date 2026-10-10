# ADR-0001 — TypeScript 5.9 strict, ESM-only, no build output

Status: accepted (Phase 1)

## Context

The platform is a long-lived library that other teams' code will build against, so the
compiler is the first line of defence. Two constraints came from the toolchain rather
than taste:

- `typescript-eslint` 8.71 does not support TypeScript 7 (beta at the time of writing),
  so the compiler version is pinned to 5.9.3 until that peer range widens.
- Cucumber 13 loads support code as ESM. A CommonJS build output would force either a
  dual-format package or a transpile step before every test run.

## Decision

- `"type": "module"`, `module`/`moduleResolution`: `NodeNext`. Relative import
  specifiers carry `.js` extensions even though the files are `.ts` — that is what
  NodeNext requires for ESM resolution at runtime.
- `noEmit: true`. Nothing is compiled to disk; `tsx` executes TypeScript directly for
  Cucumber and Vitest. Type checking is a gate (`npm run typecheck`), not a build step.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. Optional
  properties must therefore be spread conditionally (`...(x === undefined ? {} : { x })`)
  instead of assigned `undefined`, and index access is `T | undefined`.
- `erasableSyntaxOnly` is on, which forbids `enum` and constructor parameter properties.
  Constant-object unions are used instead, e.g. `PlatformErrorCode` and `RECOVERY_MODES`,
  each paired with a derived type alias.
- `lib` is `["ES2023"]` with **no DOM lib**. Browser-side code cannot accidentally
  reference `document` or `localStorage` without an explicit cast, which keeps the
  Node-side and page-side worlds visibly separate.

## Consequences

- Every type error is caught in one fast command with no stale `dist/` to reason about.
- `erasableSyntaxOnly` removes two idioms that TypeScript developers reach for
  reflexively; the cost is a few more explicit field declarations.
- Because there is no emitted output, the package `exports` map points at
  `./src/index.ts`. Consuming this from a compiled package would require adding a build
  step — acceptable while the platform is a monolith, and the decision to revisit is
  recorded in the roadmap under Phase 10.
