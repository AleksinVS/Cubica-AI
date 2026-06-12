/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for @cubica/contracts-ai.
 *
 * The AI contracts package is framework-neutral: tests run in Node and validate
 * only JSON Schema, catalog and semantic contract behavior.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
