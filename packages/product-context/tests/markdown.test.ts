/** Unit evidence for byte-local page operations and safe Markdown projections. */
import { describe, expect, it } from 'vitest';
import type { ExactPatchOperation } from '../src/generated/product-knowledge.ts';
import { applyExactOperation, generateKnowledgeIndex, knowledgeBodyHash, MarkdownPageError, parseKnowledgePage, projectKnowledgeIndex, sha256Bytes } from '../src/markdown.ts';

const encoder = new TextEncoder();
const hash = (text: string) => sha256Bytes(encoder.encode(text));
const sourceRefs: ExactPatchOperation['source_refs'] = [{ ref: 'cubica://dialog/demo/message/user-1', use: 'evidence' }];
const metadata = { schema_version: '1.0.0', type: 'decision', title: 'Private title', description: 'Private description', timestamp: '2026-08-09T10:00:00Z', cubica_id: 'knw_private', role_scope: 'developer', source_refs: sourceRefs, applies_to: ['cubica://game-project/demo'] };
const page = (body = 'alpha\nbeta\n', overrides = {}) => `---\n${JSON.stringify({ ...metadata, ...overrides })}\n---\n${body}`;
const operation = (kind: ExactPatchOperation['kind'], oldText = 'beta', newText?: string): ExactPatchOperation => ({ kind, path: 'decisions/private.md', base_file_hash: hash(page()), old_text: oldText, old_text_hash: hash(oldText), expected_matches: 1, ...(newText === undefined ? {} : { new_text: newText }), reason: 'Exact test', source_refs: metadata.source_refs });

describe('Markdown knowledge pages', () => {
  it('parses safe schema-valid YAML and hashes exact body bytes', () => {
    const bytes = encoder.encode(page('a\r\nb\n'));
    expect(parseKnowledgePage(bytes).body).toBe('a\r\nb\n');
    expect(knowledgeBodyHash(bytes)).toBe(hash('a\r\nb\n'));
  });
  it('rejects malformed YAML and schema failures', () => {
    expect(() => parseKnowledgePage(encoder.encode('---\ntitle: [\n---\nbody'))).toThrow(MarkdownPageError);
    expect(() => parseKnowledgePage(encoder.encode('---\ntitle: missing required data\n---\nbody'))).toThrow(MarkdownPageError);
  });
  it('rejects YAML object aliases before schema traversal', () => {
    const aliased = `---\nschema_version: 1.0.0\ntype: note\ntitle: Alias\ndescription: Alias description\ntimestamp: 2026-08-09T10:00:00Z\ncubica_id: knw_alias\nrole_scope: developer\nsource_refs:\n  - &source\n    ref: cubica://dialog/demo/message/user-1\n    use: evidence\n  - *source\napplies_to:\n  - cubica://game-project/demo\n---\nbody`;
    expect(() => parseKnowledgePage(encoder.encode(aliased))).toThrow('non-aliased');
  });
  it('rejects an ambiguous body field inside frontmatter', () => {
    const withMetadataBody = page('real body').replace('"type":"decision"', '"type":"decision","body":"shadow body"');
    expect(() => parseKnowledgePage(encoder.encode(withMetadataBody))).toThrow('ordinary non-aliased');
  });
  it.each([
    ['replace_exact', 'new'], ['insert_before_exact', 'new'], ['insert_after_exact', 'new'], ['delete_exact', undefined]
  ] as const)('performs %s without changing surrounding bytes', (kind, replacement) => {
    const next = applyExactOperation(encoder.encode(page()), operation(kind, 'beta', replacement));
    const text = new TextDecoder().decode(next);
    expect(text.startsWith(page().slice(0, page().indexOf('beta')))).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
  });
  it('creates a new page and rejects missing, repeated or stale anchors', () => {
    const created = applyExactOperation(undefined, { kind: 'create_file', path: 'decisions/new.md', new_text: page(), reason: 'Create', source_refs: metadata.source_refs });
    expect(parseKnowledgePage(created!).cubica_id).toBe('knw_private');
    expect(() => applyExactOperation(encoder.encode(page('beta beta')), operation('replace_exact', 'beta', 'x'))).toThrow('Base file hash');
    expect(() => applyExactOperation(encoder.encode(page('beta beta')), { ...operation('replace_exact', 'beta', 'x'), base_file_hash: hash(page('beta beta')) })).toThrow('exactly once');
  });
  it('makes a deterministic full index and a non-leaking role projection', () => {
    const publicPage = encoder.encode(page('public', { title: 'Visible', description: 'Visible description', cubica_id: 'knw_visible', role_scope: 'facilitator' }));
    const pages = new Map([['z/private.md', encoder.encode(page())], ['a/visible.md', publicPage]]);
    expect(generateKnowledgeIndex(pages)).toEqual(generateKnowledgeIndex(new Map([...pages].reverse())));
    const projection = new TextDecoder().decode(projectKnowledgeIndex(pages, { role: 'facilitator', knownAppliesTo: new Set(['cubica://game-project/demo']), currentAppliesTo: new Set(['cubica://game-project/demo']), allUserGamesConfirmed: false, globalConfirmed: false }));
    expect(projection).toContain('Visible');
    expect(projection).not.toContain('Private title');
    expect(projection).not.toContain('knw_private');
  });
});
