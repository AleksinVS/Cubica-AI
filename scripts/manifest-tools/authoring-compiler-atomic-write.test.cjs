/**
 * Regression coverage for publishing generated manifests.
 *
 * A generated manifest is a game source-of-truth artifact, unlike the
 * throwaway compile cache. This test interrupts the temporary-file write and
 * proves the previously published JSON remains readable and no partial file is
 * left for a later compile to encounter.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { writeJson } = require("./authoring-compiler.cjs");

test("failed generated-manifest write preserves the previous JSON and removes its temporary file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cubica-atomic-manifest-"));
  const target = path.join(directory, "game.manifest.json");
  const originalWriteFileSync = fs.writeFileSync;
  const previous = { version: "previous" };
  fs.writeFileSync(target, `${JSON.stringify(previous)}\n`, "utf8");

  try {
    fs.writeFileSync = (filePath, data, ...rest) => {
      if (String(filePath).startsWith(path.join(directory, ".game.manifest.json."))) {
        originalWriteFileSync(filePath, "{ partial", ...rest);
        throw new Error("simulated interrupted write");
      }
      return originalWriteFileSync(filePath, data, ...rest);
    };

    assert.throws(() => writeJson(target, { version: "next" }), /simulated interrupted write/);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), previous);
    assert.deepEqual(fs.readdirSync(directory), ["game.manifest.json"]);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
