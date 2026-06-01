/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for @cubica/editor-engine.
 *
 * The editor engine has no browser or framework dependency, so tests run in
 * Node and exercise only deterministic JSON utilities.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
