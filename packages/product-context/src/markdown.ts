/**
 * Exact Markdown page handling for the isolated product-knowledge store.
 *
 * Git stores bytes, not text.  This module therefore deliberately avoids
 * newline normalisation and applies patches on UTF-8 bytes represented by
 * JavaScript strings only after rejecting malformed UTF-8 at the boundary.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import { validateProductKnowledgeContract } from './contracts.ts';
import type { ExactPatchOperation, KnowledgePage } from './generated/product-knowledge.ts';
import { evaluateKnowledgePageRead, type KnowledgePolicyContext } from './policy.ts';

const require = createRequire(import.meta.url);
interface YamlModule {
  load(source: string, options: { schema: unknown; json: false; maxDepth: number; maxTotalMergeKeys: number }): unknown;
  JSON_SCHEMA: unknown;
}
const yaml = require('js-yaml') as YamlModule;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const frontmatter = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export class MarkdownPageError extends Error {}

/** Returns the profile's required digest of exactly the supplied UTF-8 bytes. */
export function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Parses one complete profile page with bounded nesting and no executable YAML tags. */
export function parseKnowledgePage(bytes: Uint8Array): KnowledgePage {
  const source = decoder.decode(bytes);
  const match = frontmatter.exec(source);
  if (!match) throw new MarkdownPageError('Page must contain exactly one YAML frontmatter block.');
  let metadata: unknown;
  try {
    metadata = yaml.load(match[1], {
      schema: yaml.JSON_SCHEMA,
      json: false,
      maxDepth: 40,
      maxTotalMergeKeys: 0,
    });
  }
  catch { throw new MarkdownPageError('Page YAML is malformed or uses an unsupported construct.'); }
  if (!isPlainRecord(metadata) || Object.hasOwn(metadata, 'body') || !isNonAliasedJsonTree(metadata)) {
    throw new MarkdownPageError('Page YAML must be an ordinary non-aliased JSON-compatible object.');
  }
  const candidate = { ...metadata, body: match[2] };
  const result = validateProductKnowledgeContract<KnowledgePage>('KnowledgePage', candidate);
  if (!result.ok) throw new MarkdownPageError('Page metadata does not satisfy the KnowledgePage JSON Schema.');
  return result.value;
}

/** Hashes only the exact body bytes following the closing frontmatter delimiter. */
export function knowledgeBodyHash(bytes: Uint8Array): `sha256:${string}` {
  const source = decoder.decode(bytes);
  const match = frontmatter.exec(source);
  if (!match) throw new MarkdownPageError('Page must contain exactly one YAML frontmatter block.');
  return sha256Bytes(encoder.encode(match[2]));
}

/** Serializes a schema-validated page deterministically without changing its body bytes. */
export function serializeKnowledgePage(page: KnowledgePage): Uint8Array {
  const { body, ...metadata } = page;
  // JSON is valid YAML and avoids YAML emitters silently changing timestamps.
  return encoder.encode(`---\n${JSON.stringify(metadata, null, 2)}\n---\n${body}`);
}

/** Applies a single schema-shaped exact operation and proves that its anchor occurs once. */
export function applyExactOperation(current: Uint8Array | undefined, operation: ExactPatchOperation, original = current): Uint8Array | undefined {
  if (operation.kind === 'create_file') {
    if (current !== undefined) throw new MarkdownPageError('create_file requires an absent path.');
    if (operation.new_text === undefined) throw new MarkdownPageError('create_file is missing new_text.');
    return encoder.encode(operation.new_text);
  }
  if (current === undefined) throw new MarkdownPageError('Exact operation requires an existing page.');
  if (!operation.base_file_hash || !original || sha256Bytes(original) !== operation.base_file_hash) throw new MarkdownPageError('Base file hash does not match.');
  if (operation.old_text === undefined || !operation.old_text_hash || sha256Bytes(encoder.encode(operation.old_text)) !== operation.old_text_hash) {
    throw new MarkdownPageError('Exact operation has an invalid old-text hash.');
  }
  const source = decoder.decode(current);
  const first = source.indexOf(operation.old_text);
  const last = source.lastIndexOf(operation.old_text);
  if (first < 0 || first !== last) throw new MarkdownPageError('Exact anchor must occur exactly once.');
  const before = source.slice(0, first);
  const after = source.slice(first + operation.old_text.length);
  const replacement = operation.kind === 'delete_exact' ? '' : operation.new_text;
  if (replacement === undefined) throw new MarkdownPageError('Operation is missing replacement text.');
  const next = `${before}${operation.kind === 'insert_after_exact' ? operation.old_text + replacement : operation.kind === 'insert_before_exact' ? replacement + operation.old_text : replacement}${after}`;
  // The concatenation above is deliberately constructed from the two original
  // slices: all bytes outside the one verified anchor are necessarily intact.
  return next.length === 0 ? undefined : encoder.encode(next);
}

/** Creates the full canonical index in stable path order; it never trusts model-provided index text. */
export function generateKnowledgeIndex(pages: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const entries = [...pages.entries()]
    .filter(([path]) => path !== 'index.md')
    .map(([path, bytes]) => ({ path, page: parseKnowledgePage(bytes) }))
    .sort((a, b) => codeUnitCompare(a.path, b.path));
  const lines = ['# Knowledge index', ''];
  for (const { path, page } of entries) lines.push(`- [${escapeMarkdown(page.title)}](${path}) — ${escapeMarkdown(page.description)}`);
  return encoder.encode(`${lines.join('\n')}\n`);
}

/** Builds an ephemeral index for a role; denied pages contribute no identifier, title or diagnostic. */
export function projectKnowledgeIndex(pages: ReadonlyMap<string, Uint8Array>, context: KnowledgePolicyContext): Uint8Array {
  const allowed = new Map<string, Uint8Array>();
  for (const [path, bytes] of pages) {
    if (path === 'index.md') continue;
    const page = parseKnowledgePage(bytes);
    if (evaluateKnowledgePageRead(page, context).allowed) allowed.set(path, bytes);
  }
  return generateKnowledgeIndex(allowed);
}

function escapeMarkdown(value: string): string { return value.replace(/[\\\[\]\n\r]/g, (character) => character === '\n' || character === '\r' ? ' ' : `\\${character}`); }
/** UTF-16 code-unit ordering is specified by JavaScript and independent of ICU locale data. */
export function codeUnitCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
/**
 * JSON Schema expects a tree, while YAML aliases can construct a shared or
 * cyclic object graph. Rejecting repeated object identities before Ajv runs
 * prevents alias cycles and keeps the Markdown contract equivalent to JSON.
 */
function isNonAliasedJsonTree(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isNonAliasedJsonTree(item, seen));
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every((item) => isNonAliasedJsonTree(item, seen));
}
