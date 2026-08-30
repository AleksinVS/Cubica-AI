/**
 * Immutable, exact-key registry for versioned Mechanics artifacts.
 *
 * The registry deliberately knows nothing about concrete games or TypeScript
 * executors. It stores trusted platform registrations and resolves only the
 * complete `moduleId + moduleVersion + artifactHash` identity. Callers may
 * attach opaque profile identifiers, but session data can never provide code
 * or redirect a registration to another implementation.
 */

const EXACT_HASH = /^sha256:[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+$/u;

function exactArtifactKey(identity) {
  assertIdentity(identity);
  return JSON.stringify([
    identity.moduleId,
    identity.moduleVersion,
    identity.artifactHash
  ]);
}

/**
 * Build a closed registry from trusted process-owned declarations.
 *
 * Available and blocked records intentionally share the same exact key space:
 * a vulnerable or unavailable snapshot cannot coexist with an available
 * executor under the same identity.
 */
function createMechanicsArtifactRegistry(records) {
  const entries = new Map();
  // One executor profile owns one complete trusted operation namespace. The
  // session lock can only select an allow-list of modules from that namespace;
  // it can never redefine operation ownership.
  const profileOperationOwners = new Map();
  for (const raw of records) {
    assertRecord(raw);
    const key = exactArtifactKey(raw);
    if (entries.has(key)) {
      throw new TypeError(`Duplicate Mechanics artifact registration for ${key}`);
    }
    if (raw.state !== "available" && raw.state !== "blocked") {
      throw new TypeError(`Mechanics artifact "${raw.moduleId}" has an invalid state`);
    }
    if (raw.state === "blocked" && (typeof raw.reason !== "string" || raw.reason.length === 0)) {
      throw new TypeError(`Blocked Mechanics artifact "${raw.moduleId}" requires a reason`);
    }
    if (raw.state === "available") {
      for (const profile of ["validationProfileId", "executorProfileId"]) {
        if (typeof raw[profile] !== "string" || raw[profile].length === 0) {
          throw new TypeError(`Available Mechanics artifact "${raw.moduleId}" requires ${profile}`);
        }
      }
      if (!Array.isArray(raw.operations) || raw.operations.length === 0 ||
          raw.operations.length > 256 || !raw.operations.every(isIdentifier) ||
          new Set(raw.operations).size !== raw.operations.length) {
        throw new TypeError(`Available Mechanics artifact "${raw.moduleId}" requires bounded operation ids`);
      }
      let operationOwners = profileOperationOwners.get(raw.executorProfileId);
      if (!operationOwners) {
        operationOwners = new Map();
        profileOperationOwners.set(raw.executorProfileId, operationOwners);
      }
      for (const operation of raw.operations) {
        const existingOwner = operationOwners.get(operation);
        if (existingOwner !== undefined && existingOwner !== raw.moduleId) {
          throw new TypeError(
            `Mechanics executor profile "${raw.executorProfileId}" assigns operation "${operation}" ` +
            `to both "${existingOwner}" and "${raw.moduleId}"`
          );
        }
        operationOwners.set(operation, raw.moduleId);
      }
    }
    const algorithmVersions = Object.freeze({ ...(raw.algorithmVersions || {}) });
    entries.set(key, Object.freeze({
      ...raw,
      algorithmVersions,
      ...(Array.isArray(raw.operations) ? { operations: Object.freeze([...raw.operations]) } : {})
    }));
  }

  function resolve(identity) {
    let key;
    try {
      key = exactArtifactKey(identity);
    } catch (error) {
      return Object.freeze({
        state: "missing",
        identity: cloneIdentity(identity),
        reason: error instanceof Error ? error.message : String(error)
      });
    }
    const entry = entries.get(key);
    if (!entry) {
      return Object.freeze({
        state: "missing",
        identity: cloneIdentity(identity),
        reason: "the exact artifact triple is not registered"
      });
    }
    if (!sameStringMap(identity.algorithmVersions || {}, entry.algorithmVersions)) {
      return Object.freeze({
        state: "missing",
        identity: cloneIdentity(identity),
        reason: "algorithm versions do not match the exact artifact registration"
      });
    }
    return entry;
  }

  /**
   * Resolve a complete module lock without falling back or mixing profiles.
   *
   * A future release may register several compatible artifacts in one
   * validation/executor profile. Modules from different profiles are rejected
   * because that would silently compose a runtime snapshot never published by
   * the platform.
   */
  function resolveSet(moduleLock) {
    if (!isObject(moduleLock) || Object.keys(moduleLock).length === 0) {
      return Object.freeze({ state: "missing", reason: "moduleLock must contain at least one exact module identity" });
    }
    const modules = new Map();
    let validationProfileId;
    let executorProfileId;
    for (const [alias, identity] of Object.entries(moduleLock)) {
      const resolved = resolve(identity);
      if (resolved.state !== "available") {
        return Object.freeze({ ...resolved, alias });
      }
      if (modules.has(resolved.moduleId)) {
        return Object.freeze({
          state: "missing",
          alias,
          identity: cloneIdentity(identity),
          reason: `module "${resolved.moduleId}" is locked more than once`
        });
      }
      validationProfileId ??= resolved.validationProfileId;
      executorProfileId ??= resolved.executorProfileId;
      if (
        validationProfileId !== resolved.validationProfileId ||
        executorProfileId !== resolved.executorProfileId
      ) {
        return Object.freeze({
          state: "missing",
          alias,
          identity: cloneIdentity(identity),
          reason: "the exact modules belong to incompatible validation or executor profiles"
        });
      }
      modules.set(resolved.moduleId, resolved);
    }
    return Object.freeze({
      state: "available",
      modules,
      validationProfileId,
      executorProfileId,
      // Return a defensive copy of the complete profile namespace. Mutating a
      // resolved view cannot alter the process-owned registry.
      operationModules: new Map(profileOperationOwners.get(executorProfileId))
    });
  }

  return Object.freeze({
    resolve,
    resolveSet,
    entries: () => Object.freeze([...entries.values()])
  });
}

function assertIdentity(value) {
  if (!isObject(value)) throw new TypeError("Mechanics artifact identity must be an object");
  if (!isIdentifier(value.moduleId)) throw new TypeError("Mechanics moduleId is malformed");
  if (typeof value.moduleVersion !== "string" || !SEMVER.test(value.moduleVersion)) {
    throw new TypeError("Mechanics moduleVersion is malformed");
  }
  if (typeof value.artifactHash !== "string" || !EXACT_HASH.test(value.artifactHash)) {
    throw new TypeError("Mechanics artifactHash is malformed");
  }
}

function assertRecord(value) {
  assertIdentity(value);
  if (!isObject(value.algorithmVersions) && value.algorithmVersions !== undefined) {
    throw new TypeError(`Mechanics artifact "${value.moduleId}" has malformed algorithmVersions`);
  }
  if (!Object.entries(value.algorithmVersions || {}).every(([key, item]) => isIdentifier(key) && isIdentifier(item))) {
    throw new TypeError(`Mechanics artifact "${value.moduleId}" has malformed algorithmVersions`);
  }
}

function cloneIdentity(value) {
  if (!isObject(value)) return value;
  return Object.freeze({
    moduleId: value.moduleId,
    moduleVersion: value.moduleVersion,
    artifactHash: value.artifactHash,
    ...(isObject(value.algorithmVersions)
      ? { algorithmVersions: Object.freeze({ ...value.algorithmVersions }) }
      : {})
  });
}

function sameStringMap(left, right) {
  const leftEntries = Object.entries(left).sort(compareEntries);
  const rightEntries = Object.entries(right).sort(compareEntries);
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function compareEntries([left], [right]) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  createMechanicsArtifactRegistry,
  exactArtifactKey
};
