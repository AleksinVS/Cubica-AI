#!/usr/bin/env node
/**
 * Validates the Node.js runtime contract shared by active workspaces and CI.
 *
 * Cubica executes TypeScript directly in runtime-api and in the editor load
 * profiler. The latter needs `--experimental-transform-types`, which first
 * appeared in Node.js 22.7.0. Keeping the declared engines, lock metadata and
 * CI version selector aligned prevents installations that succeed on paper
 * but fail as soon as a canonical command starts.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const minimumVersion = [22, 7, 0];
const workspaceEngine = ">=22.7.0";
const portalEngine = ">=22.7.0 <=22.x.x";
const supportedLtsLine = "22";

function fail(message) {
  console.error(`validate-node-runtime: ${message}`);
  process.exit(1);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function assertEqual(actual, expected, context) {
  if (actual !== expected) {
    fail(`${context}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function versionAtLeast(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) {
      return true;
    }
    if (actual[index] < minimum[index]) {
      return false;
    }
  }
  return true;
}

const runningVersion = process.versions.node.split(".").map(Number);
if (!versionAtLeast(runningVersion, minimumVersion)) {
  fail(`Node.js ${minimumVersion.join(".")} or newer is required; running ${process.versions.node}`);
}

// Ask the executable to accept both flags. Node's `--eval` input does not use
// the same `.ts` loader path, so a version probe is the side-effect-free way to
// detect an unknown option here; canonical runtime smoke tests execute `.ts`.
for (const flag of ["--experimental-strip-types", "--experimental-transform-types"]) {
  try {
    execFileSync(process.execPath, [flag, "--version"], {
      stdio: "pipe"
    });
  } catch (error) {
    fail(`${flag} is unavailable in Node.js ${process.versions.node}: ${error.message}`);
  }
}

const rootPackage = readJson("package.json");
const rootLock = readJson("package-lock.json");
assertEqual(rootPackage.engines?.node, workspaceEngine, "package.json engines.node");
assertEqual(rootLock.packages?.[""]?.engines?.node, workspaceEngine, "package-lock.json root engines.node");
assertEqual(readText(".nvmrc").trim(), supportedLtsLine, ".nvmrc");

for (const workspace of rootPackage.workspaces ?? []) {
  const workspacePackage = readJson(`${workspace}/package.json`);
  const lockedWorkspace = rootLock.packages?.[workspace];
  assertEqual(workspacePackage.engines?.node, workspaceEngine, `${workspace}/package.json engines.node`);
  assertEqual(lockedWorkspace?.engines?.node, workspaceEngine, `package-lock.json ${workspace} engines.node`);

  // Some applications retain a standalone lockfile for isolated deployment.
  // When present, its root metadata must not contradict the workspace lock.
  const standaloneLockPath = `${workspace}/package-lock.json`;
  if (fs.existsSync(path.join(repoRoot, standaloneLockPath))) {
    const standaloneLock = readJson(standaloneLockPath);
    assertEqual(
      standaloneLock.packages?.[""]?.engines?.node,
      workspaceEngine,
      `${standaloneLockPath} root engines.node`
    );
  }
}

// The portal backend is installed outside the root workspace and additionally
// caps Node at major 22 because that is the supported range of its current
// Strapi stack. It still shares Cubica's 22.7.0 minimum and CI LTS selector.
const portalPackage = readJson("services/portal-backend/package.json");
const portalLock = readJson("services/portal-backend/package-lock.json");
assertEqual(portalPackage.engines?.node, portalEngine, "portal-backend package.json engines.node");
assertEqual(portalLock.packages?.[""]?.engines?.node, portalEngine, "portal-backend package-lock engines.node");
assertEqual(readText("services/portal-backend/.nvmrc").trim(), supportedLtsLine, "portal-backend .nvmrc");

const ciWorkflow = readText(".github/workflows/ci.yml");
if (ciWorkflow.includes("node-version: 20")) {
  fail("CI still selects Node.js 20, which cannot satisfy the repository runtime contract");
}
if (!ciWorkflow.includes("node-version-file: .nvmrc")) {
  fail("CI must select the root Node.js LTS line through .nvmrc");
}
if (!ciWorkflow.includes("node-version-file: services/portal-backend/.nvmrc")) {
  fail("portal CI must select its supported Node.js line through the service .nvmrc");
}

console.log(`validate-node-runtime: OK (Node.js ${process.versions.node}, minimum 22.7.0)`);
