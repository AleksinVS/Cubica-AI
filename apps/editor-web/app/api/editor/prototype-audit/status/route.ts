/**
 * Exposes the latest ADR-050 prototype audit status to editor-web.
 *
 * The route is fail-open: missing or malformed audit artifacts become a
 * nonblocking notification instead of a 500 response, because authoring work
 * must continue even when the weekly audit was skipped or delayed.
 */
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { readPrototypeAuditStatus } from "@/lib/prototype-audit-status";

export const runtime = "nodejs";

export async function GET() {
  const result = await readPrototypeAuditStatus({
    repoRoot: configuredEditorProjectRoot() ?? process.cwd()
  });

  return Response.json(result, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
