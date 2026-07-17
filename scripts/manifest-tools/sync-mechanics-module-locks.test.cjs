/**
 * Regression tests for the compiler-owned Mechanics module-lock boundary.
 *
 * A source lock is forbidden because the compiler must derive the complete
 * lock and every dependent hash as one deterministic publication operation.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  collectSourceModuleLocks
} = require("./sync-mechanics-module-locks.cjs");

test("accepts authoring Mechanics without a compiler-owned module lock", () => {
  const source = {
    root: {
      mechanics: {
        apiVersion: "cubica.dev/mechanics/v1alpha1",
        plans: {}
      }
    }
  };

  assert.deepEqual(collectSourceModuleLocks(source), []);
});

test("reports every forbidden source module lock with an exact JSON pointer", () => {
  const source = {
    root: {
      mechanics: {
        apiVersion: "cubica.dev/mechanics/v1alpha1",
        moduleLock: {}
      },
      nested: [
        {
          apiVersion: "cubica.dev/mechanics/v1alpha1",
          moduleLock: {}
        }
      ]
    }
  };

  assert.deepEqual(collectSourceModuleLocks(source), [
    "/root/mechanics/moduleLock",
    "/root/nested/0/moduleLock"
  ]);
});
