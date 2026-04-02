/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest configuration for @cubica/player-web.
 *
 * Enables:
 * - React plugin for JSX and .tsx support
 * - TypeScript with path aliases matching tsconfig.json
 * - DOM environment for React component testing
 * - Coverage is intentionally omitted (bounded slice scope)
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: [],
    setupFiles: [],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
