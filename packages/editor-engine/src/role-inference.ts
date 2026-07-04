/**
 * Editor-only semantic role/title/summary inference for authoring graph nodes.
 *
 * The graph projection needs a human-meaningful role ("action", "ui-screen",
 * "metric", ...) for each JSON node so the canvas can style and group it. These
 * roles are editor UX hints only; they never change gameplay or the authoring
 * JSON, which stays the single source of truth (ADR-025).
 */
import {
  compactSummary,
  compactTitle,
  getJsonValueType,
  isArrayIndex,
  isPlainJsonObject,
  normalizeToken,
  shortTypeName,
  titleFromToken
} from "./shared.ts";
import {
  lastPointerSegmentOrRoot,
  localReferenceToPointer,
  parentPointer,
  parseJsonPointer
} from "./json-pointer-patch.ts";
import { isDefinitionPointer } from "./semantics.ts";
import type { AuthoringPresentationRole, AuthoringSemanticRole, JsonObject, JsonValue } from "./types.ts";

/**
 * Canonical mapping from an EXPLICIT authoring role token to a semantic role.
 *
 * Keys are already `normalizeToken`-normalized (lowercase, space-separated), so
 * an authoring annotation such as `_type: "ui-screen"`, `role: "uiScreen"`, or a
 * Russian manifest's `_type: "action"` all resolve here directly, independent of
 * the JSON path language. This is a data-driven table, not a per-game hardcode:
 * it only lists platform-level semantic role names and their well-known
 * synonyms, so it stays game-agnostic (ADR-025 keeps JSON Schema as the SSOT;
 * this table only reads authoring annotations, it does not validate shape).
 */
const AUTHORITATIVE_ROLE_BY_TOKEN: ReadonlyMap<string, AuthoringSemanticRole> = new Map([
  ["manifest root", "manifest-root"],
  ["definition", "definition"],
  ["scenario", "scenario"],
  ["flow", "scenario"],
  ["story", "scenario"],
  ["step", "step"],
  ["stage", "step"],
  ["scene", "step"],
  ["sequence", "step"],
  ["action", "action"],
  ["command", "action"],
  ["operation", "action"],
  ["condition", "condition"],
  ["guard", "condition"],
  ["predicate", "condition"],
  ["state", "state"],
  ["metric", "metric"],
  ["score", "metric"],
  ["stat", "metric"],
  ["counter", "metric"],
  ["ui screen", "ui-screen"],
  ["screen", "ui-screen"],
  ["page", "ui-screen"],
  ["view", "ui-screen"],
  ["ui component", "ui-component"],
  ["component", "ui-component"],
  ["widget", "ui-component"],
  ["asset", "asset"],
  ["image", "asset"],
  ["media", "asset"],
  ["sprite", "asset"],
  ["reference", "reference"],
  ["collection", "collection"],
  ["property", "property"]
]);

/**
 * Reads an AUTHORITATIVE semantic role from a node's explicit authoring
 * annotations, or returns undefined when none maps cleanly.
 *
 * Only exact (normalized) matches count — both the full annotation and its short
 * dotted tail (`"ui.Screen"` -> `"screen"`) are tried — so game-specific typed
 * annotations such as `_type: "game.StartAction"` (-> `"start action"`) do NOT
 * match here and fall through to the substring fallback, preserving existing
 * behaviour. Annotations are checked in priority order `_type`, `role`,
 * `_semantics`.
 */
function authoritativeSemanticRole(value: JsonValue): AuthoringSemanticRole | undefined {
  if (!isPlainJsonObject(value)) {
    return undefined;
  }

  for (const key of ["_type", "role", "_semantics"] as const) {
    const raw = value[key];
    if (typeof raw !== "string" || raw.trim() === "") {
      continue;
    }

    const full = normalizeToken(raw);
    const short = normalizeToken(shortTypeTail(raw));
    const mapped = AUTHORITATIVE_ROLE_BY_TOKEN.get(full) ?? AUTHORITATIVE_ROLE_BY_TOKEN.get(short);
    if (mapped !== undefined) {
      return mapped;
    }
  }

  return undefined;
}

/** Returns the last dotted segment of a token, e.g. `game.Step` -> `Step`. */
function shortTypeTail(value: string): string {
  const parts = value.split(".");
  return parts[parts.length - 1] ?? value;
}

export function inferSemanticRole(value: JsonValue, pointer: string): AuthoringSemanticRole {
  if (pointer === "") {
    return "manifest-root";
  }

  const segments = parseJsonPointer(pointer);
  const last = normalizeToken(segments.at(-1));
  const parent = normalizeToken(segments.at(-2));
  const normalizedPath = segments.map(normalizeToken);
  const typeHint = isPlainJsonObject(value) && typeof value._type === "string" ? normalizeToken(value._type) : "";
  const semanticsHint = isPlainJsonObject(value) && typeof value._semantics === "string" ? normalizeToken(value._semantics) : "";
  const joinedSignals = `${typeHint} ${semanticsHint} ${normalizedPath.join(" ")}`;

  if (isDefinitionPointer(pointer)) {
    return "definition";
  }

  if (typeof value === "string" && localReferenceToPointer(value) !== undefined) {
    return "reference";
  }

  if (last === "$ref") {
    return "reference";
  }

  if (!Array.isArray(value) && !isPlainJsonObject(value)) {
    if (matchesAny(joinedSignals, ["metric", "score", "stat", "counter"]) || parent === "metrics") {
      return "metric";
    }

    return "property";
  }

  // AUTHORITATIVE first: an explicit `_type`/`role`/`_semantics` role token wins
  // over any path/label substring guess. This is what stops non-English
  // manifests from silently degrading — the author's declared role is honoured
  // regardless of the language of pointer segments and labels (LEGACY-0019).
  const authoritative = authoritativeSemanticRole(value);
  if (authoritative !== undefined) {
    return authoritative;
  }

  // FALLBACK (known limitation, LEGACY-0019): when there is no authoritative
  // role annotation, classification degrades to ENGLISH substring heuristics
  // over the `_type`/`_semantics` hints and the JSON path. These only work for
  // English-ish tokens; non-English manifests should carry an explicit `_type`/
  // `role` so they hit the authoritative branch above instead of this fallback.
  if (matchesAny(joinedSignals, ["asset", "image", "media", "sprite", "background", "audio", "video"])) {
    return "asset";
  }

  if (matchesAny(joinedSignals, ["screen", "page", "view"])) {
    return "ui-screen";
  }

  if (matchesAny(joinedSignals, ["component", "widget", "block", "button", "area", "layout", "panel", "topbar", "sidebar"])) {
    return "ui-component";
  }

  if (matchesAny(joinedSignals, ["action", "command", "handler", "operation"]) || parent === "actions") {
    return "action";
  }

  if (matchesAny(joinedSignals, ["condition", "guard", "predicate", "branch", "when", "if"]) || parent === "conditions") {
    return "condition";
  }

  if (matchesAny(joinedSignals, ["metric", "score", "stat", "counter"]) || parent === "metrics") {
    return "metric";
  }

  if (matchesAny(joinedSignals, ["state", "timeline"]) || parent === "state") {
    return "state";
  }

  if (matchesAny(joinedSignals, ["scenario", "flow", "root", "story", "content"])) {
    return "scenario";
  }

  if (matchesAny(joinedSignals, ["step", "stage", "sequence", "scene", "info", "choice"]) || matchesAny(parent, ["steps", "stages", "scenes", "infos", "choices"])) {
    return "step";
  }

  if (Array.isArray(value) || isPlainJsonObject(value)) {
    return "collection";
  }

  return "property";
}

export function inferSemanticTitle(value: JsonValue, pointer: string, semanticRole: AuthoringSemanticRole): string {
  if (pointer === "") {
    const rootName = isPlainJsonObject(value) ? findNestedString(value, ["meta", "name"]) ?? findNestedString(value, ["name"]) : undefined;
    return rootName ?? "Authoring manifest";
  }

  if (isPlainJsonObject(value)) {
    for (const key of ["title", "name", "displayName", "id", "key", "_type"] as const) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim() !== "") {
        return compactTitle(candidate);
      }
    }
  }

  const last = lastPointerSegmentOrRoot(pointer);
  if (last !== "/" && !isArrayIndex(last)) {
    return titleFromToken(last);
  }

  const parent = parentPointer(pointer);
  const parentLabel = parent === undefined ? "item" : titleFromToken(lastPointerSegmentOrRoot(parent));
  return `${parentLabel} ${last}`;
}

export function inferSemanticSummary(
  value: JsonValue,
  pointer: string,
  semanticRole: AuthoringSemanticRole,
  childCount: number
): string {
  if (isPlainJsonObject(value) && typeof value._semantics === "string" && value._semantics.trim() !== "") {
    return compactSummary(value._semantics);
  }

  if (Array.isArray(value)) {
    return `${childCount} items`;
  }

  if (isPlainJsonObject(value)) {
    const type = typeof value._type === "string" ? ` · ${shortTypeName(value._type)}` : "";
    return `${semanticRole}${type} · ${childCount} fields`;
  }

  return `${semanticRole} · ${getJsonValueType(value)}`;
}

export function presentationRoleForSemanticRole(role: AuthoringSemanticRole): AuthoringPresentationRole {
  switch (role) {
    case "manifest-root":
      return "root";
    case "definition":
      return "definition";
    case "scenario":
    case "step":
      return "flow";
    case "action":
      return "operation";
    case "condition":
      return "decision";
    case "state":
      return "state";
    case "metric":
      return "metric";
    case "ui-screen":
      return "screen";
    case "ui-component":
      return "component";
    case "asset":
      return "asset";
    case "reference":
      return "reference";
    case "property":
      return "property";
    case "collection":
      return "collection";
  }
}

function matchesAny(value: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function findNestedString(value: JsonObject, path: readonly string[]): string | undefined {
  let current: JsonValue | undefined = value;

  for (const segment of path) {
    if (!isPlainJsonObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return typeof current === "string" && current.trim() !== "" ? current : undefined;
}
