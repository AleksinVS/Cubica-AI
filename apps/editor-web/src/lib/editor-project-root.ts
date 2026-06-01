/**
 * Resolves the project repository root used by editor-web route handlers.
 *
 * By default the editor uses the current monorepo checkout. Tests may provide
 * `EDITOR_PROJECT_ROOT` to point the editor at an isolated Git repository so
 * session worktrees are created from a clean, committed fixture instead of the
 * developer's dirty working tree.
 */
import path from "node:path";

export function configuredEditorProjectRoot(): string | undefined {
  const rawRoot = process.env.EDITOR_PROJECT_ROOT;
  if (rawRoot === undefined || rawRoot.trim() === "") {
    return undefined;
  }

  return path.resolve(rawRoot);
}
