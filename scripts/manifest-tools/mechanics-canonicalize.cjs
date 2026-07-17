/**
 * Canonical JSON and SHA-256 helpers for published Mechanics IR.
 *
 * Mechanics hashes are replay contracts, so they cannot depend on insertion
 * order, locale, or a JavaScript engine's object enumeration details. Keys are
 * ordered by their UTF-8 bytes; arrays keep semantic order.
 */

const { createHash } = require("node:crypto");

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalizeMechanicsJson(value) {
  return serialize(value, "$", new Set());
}

function serialize(value, location, ancestors) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${location} contains a non-finite number`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return withCycleGuard(value, location, ancestors, () =>
      `[${value.map((entry, index) => serialize(entry, `${location}[${index}]`, ancestors)).join(",")}]`
    );
  }
  if (isPlainObject(value)) {
    return withCycleGuard(value, location, ancestors, () => {
      const entries = Object.keys(value)
        .sort(compareUtf8)
        .map((key) => `${JSON.stringify(key)}:${serialize(value[key], `${location}.${key}`, ancestors)}`);
      return `{${entries.join(",")}}`;
    });
  }
  throw new TypeError(`${location} is not a JSON value`);
}

function withCycleGuard(value, location, ancestors, callback) {
  if (ancestors.has(value)) {
    throw new TypeError(`${location} contains a cycle`);
  }
  ancestors.add(value);
  try {
    return callback();
  } finally {
    ancestors.delete(value);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mechanicsSha256(value) {
  const digest = createHash("sha256").update(canonicalizeMechanicsJson(value)).digest("hex");
  return `sha256:${digest}`;
}

module.exports = {
  canonicalizeMechanicsJson,
  compareUtf8,
  mechanicsSha256
};
