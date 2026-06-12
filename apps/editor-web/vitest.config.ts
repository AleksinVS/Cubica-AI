import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(appRoot, "src")
    }
  },
  test: {
    environment: "happy-dom",
    include: [
      "app/**/*.test.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx"
    ]
  }
});
