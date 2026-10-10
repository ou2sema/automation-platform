import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Framework self-tests must not share mutable state with each other.
    isolate: true,
    // Parallel isolation behaviour is explicitly tested later (Phase 10);
    // files run sequentially for now so diagnostics stay readable on Windows.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    reporters: ["default"],
    clearMocks: true,
    restoreMocks: true,
  },
});
