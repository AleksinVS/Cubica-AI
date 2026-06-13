#!/usr/bin/env node
/**
 * Validates ADR-044 Agent UI dependency boundaries.
 *
 * CopilotKit and AG-UI are adapter dependencies. This script blocks imports of
 * those libraries from Cubica core packages, runtime services, games and other
 * non-adapter code so the assistant UI can be replaced without domain rewrites.
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");

const importRules = [
  {
    label: "CopilotKit",
    packagePattern: /^@copilotkit(?:\/|$)/u,
    allowedFiles: new Set([
      "apps/editor-web/app/api/copilotkit/route.ts",
      "apps/editor-web/app/layout.tsx",
      "apps/editor-web/src/components/editor-agent-ui.tsx"
    ])
  },
  {
    label: "AG-UI",
    packagePattern: /^@ag-ui(?:\/|$)/u,
    allowedFiles: new Set([
      "apps/editor-web/app/api/copilotkit/route.ts",
      "apps/editor-web/app/api/editor/agent/ag-ui/route.ts",
      "apps/editor-web/src/lib/ag-ui-event-adapter.test.ts",
      "apps/editor-web/src/lib/ag-ui-event-adapter.ts",
      "apps/editor-web/src/lib/editor-agent-local-backend.test.ts",
      "apps/editor-web/src/lib/editor-agent-local-backend.ts"
    ])
  },
  {
    label: "LLM provider SDK",
    packagePattern: /^(?:openai|@openai\/.+|@anthropic-ai\/.+|@google\/generative-ai|ai)(?:\/|$)/u,
    allowedFiles: new Set([])
  }
];

const scannedRoots = ["apps", "packages", "services", "SDK", "games", "scripts"];
const scannedExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ignoredDirectoryNames = new Set([".git", ".next", ".tmp", "dist", "node_modules"]);
const importPattern =
  /(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|export\s+(?:type\s+)?[\s\S]*?\s+from\s+|require\(|import\()\s*["']([^"']+)["']/gu;

function relative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function walkFiles(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) {
    return [];
  }

  const files = [];
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) {
          stack.push(absolutePath);
        }
        continue;
      }

      if (scannedExtensions.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  }

  return files;
}

function findImports(text) {
  const imports = [];
  importPattern.lastIndex = 0;
  for (const match of text.matchAll(importPattern)) {
    if (typeof match[1] === "string") {
      imports.push(match[1]);
    }
  }
  return imports;
}

const violations = [];

for (const root of scannedRoots) {
  for (const filePath of walkFiles(path.join(repoRoot, root))) {
    const relativePath = relative(filePath);
    const imports = findImports(fs.readFileSync(filePath, "utf8"));
    for (const importedModule of imports) {
      for (const rule of importRules) {
        if (rule.packagePattern.test(importedModule) && !rule.allowedFiles.has(relativePath)) {
          violations.push(`${relativePath} imports ${importedModule}; ${rule.label} imports are allowed only in ADR-044 adapter files.`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("validate-agent-ui-boundaries: failed");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("validate-agent-ui-boundaries: OK");
