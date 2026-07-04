/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for @cubica/contracts-manifest.
 *
 * Tests are framework-neutral and run in Node. They validate every shipped
 * game and UI manifest against the canonical JSON Schemas (the single source of
 * truth per ADR-025/ADR-056), so schema/data drift fails the build.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
