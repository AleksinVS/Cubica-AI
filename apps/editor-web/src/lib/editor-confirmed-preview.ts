/** Process-local handoff of an exact, already validated mutation candidate. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { EditorCompileArtifact } from "./compiler-workflow";
import type { PlayerWebPluginBundleForRuntime } from "./project-plugin-validation";
import { fingerprintProjectPluginInputs } from "./project-plugin-validation";

export interface ConfirmedCandidate {
  readonly repoRoot: string;
  readonly gameId: string;
  readonly candidateRoot: string;
  readonly sourceFingerprint: string;
  readonly pluginFingerprint: string;
  readonly compilerFingerprint: string;
  readonly artifactFingerprint: string;
  readonly artifacts: readonly EditorCompileArtifact[];
  readonly pluginBundles: readonly PlayerWebPluginBundleForRuntime[];
}

const confirmedBySession = new Map<string, ConfirmedCandidate>();

export function rememberConfirmedCandidate(sessionId: string, candidate: ConfirmedCandidate): void {
  confirmedBySession.delete(sessionId);
  confirmedBySession.set(sessionId, candidate);
  if (confirmedBySession.size > 16) confirmedBySession.delete(confirmedBySession.keys().next().value!);
}

export function clearConfirmedCandidate(sessionId: string): void {
  confirmedBySession.delete(sessionId);
}

export function clearConfirmedCandidatesForTests(): void {
  confirmedBySession.clear();
}

export async function reusableConfirmedCandidate(input: {
  readonly sessionId: string;
  readonly repoRoot: string;
  readonly gameId: string;
}): Promise<ConfirmedCandidate | undefined> {
  const candidate = confirmedBySession.get(input.sessionId);
  if (candidate === undefined || candidate.repoRoot !== input.repoRoot || candidate.gameId !== input.gameId) return undefined;
  try {
    const [source, plugin, compiler, artifact] = await Promise.all([
      fingerprintGameTree(input.repoRoot, input.gameId),
      fingerprintProjectPluginInputs(input),
      fingerprintCompilerInputs(input.repoRoot),
      fingerprintCandidateArtifacts(candidate.candidateRoot, candidate.artifacts, candidate.pluginBundles)
    ]);
    if (source === candidate.sourceFingerprint && plugin === candidate.pluginFingerprint &&
        compiler === candidate.compilerFingerprint && artifact === candidate.artifactFingerprint) return candidate;
  } catch { /* Missing or damaged candidate falls back to ordinary validation. */ }
  confirmedBySession.delete(input.sessionId);
  return undefined;
}

export async function fingerprintGameTree(repoRoot: string, gameId: string): Promise<string> {
  const root = path.join(repoRoot, "games", gameId);
  const hash = createHash("sha256");
  await hashTree(hash, root, root);
  return hash.digest("hex");
}

/** Covers the compiler's scripts, schemas, invariant runtime corpus and editor validation code. */
export async function fingerprintCompilerInputs(repoRoot: string): Promise<string> {
  let root = path.resolve(repoRoot);
  while (!existsSync(path.join(root, "PROJECT_STRUCTURE.yaml"))) {
    const parent = path.dirname(root);
    if (parent === root) throw new Error("Compiler repository root was not found.");
    root = parent;
  }
  const hash = createHash("sha256");
  for (const relative of [
    "scripts/manifest-tools",
    "docs/architecture/schemas",
    "services/runtime-api/src/modules",
    "packages/editor-engine/src",
    "apps/editor-web/src/lib/compiler-workflow.ts",
    "apps/editor-web/src/lib/editor-json-schema.ts",
    "apps/editor-web/src/lib/editor-file-cache.ts",
    "package-lock.json"
  ]) await hashTree(hash, root, path.join(root, relative));
  return hash.digest("hex");
}

async function hashTree(hash: ReturnType<typeof createHash>, root: string, filePath: string): Promise<void> {
  const detail = await lstat(filePath);
  hash.update(path.relative(root, filePath));
  hash.update("\0");
  if (detail.isDirectory()) {
    hash.update("directory\0");
    for (const entry of (await readdir(filePath)).sort()) await hashTree(hash, root, path.join(filePath, entry));
  } else if (detail.isFile()) {
    hash.update("file\0");
    hash.update(await readFile(filePath));
    hash.update("\0");
  } else {
    throw new Error("Candidate input contains a nonregular filesystem entry.");
  }
}

export async function fingerprintCandidateArtifacts(candidateRoot: string,
  artifacts: readonly EditorCompileArtifact[], bundles: readonly PlayerWebPluginBundleForRuntime[]): Promise<string> {
  if (artifacts.length === 0) throw new Error("Candidate has no compiler artifacts.");
  const hash = createHash("sha256");
  const files = [...artifacts.flatMap((artifact) => [artifact.generatedFile, artifact.sourceMapFile]),
    ...bundles.map((bundle) => bundle.filePath)].sort();
  for (const file of files) {
    const absolute = path.resolve(candidateRoot, file);
    if (!absolute.startsWith(`${path.resolve(candidateRoot)}${path.sep}`)) throw new Error("Candidate artifact escapes its root.");
    const detail = await lstat(absolute);
    if (!detail.isFile()) throw new Error("Candidate artifact is not a regular file.");
    const bytes = await readFile(absolute);
    const bundle = bundles.find((item) => item.filePath === file);
    if (bundle !== undefined && createHash("sha256").update(bytes).digest("hex") !== bundle.contentHash) {
      throw new Error("Candidate plugin bundle hash mismatch.");
    }
    hash.update(file);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}
