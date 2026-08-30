const assert = require("node:assert/strict");
const test = require("node:test");
const {
  collectModuleSpecifiers,
  collectStringArrayConstant
} = require("./typescript-import-analysis.cjs");

test("collects declarations, import types and statically computed imports", () => {
  const source = `
    import React from "react";
    export { x } from "next/navigation";
    type T = import("react-dom").Root;
    const lazy = () => import("react" + "-dom");
    const scope = "@copilotkit/";
    const moduleName = scope + "react-core";
    const adapter = require(moduleName);
    const ignored = "require('openai')";
  `;

  assert.deepEqual(
    collectModuleSpecifiers(source, "fixture.ts").sort(),
    ["@copilotkit/react-core", "next/navigation", "react", "react-dom", "react-dom"]
  );
});

test("does not mistake comments or ordinary strings for imports", () => {
  const source = `// import "next"\nconst text = "require('@ag-ui/core')";`;
  assert.deepEqual(collectModuleSpecifiers(source, "fixture.js"), []);
});

test("a same-named binding in another scope cannot hide a forbidden computed import", () => {
  const source = `
    const packageName = "react";
    require(packageName);
    function unrelated() {
      const packageName = "safe-package";
      require(packageName);
    }
  `;

  assert.deepEqual(
    [...new Set(collectModuleSpecifiers(source, "fixture.js"))].sort(),
    ["react", "safe-package"]
  );
});

test("reads a string-array constant through the TypeScript AST", () => {
  const source = `export const OPERATORS = ["var", "+", "min"] as const;`;
  assert.deepEqual(collectStringArrayConstant(source, "fixture.ts", "OPERATORS"), ["var", "+", "min"]);
});
