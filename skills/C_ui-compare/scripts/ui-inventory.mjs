/**
 * Shared validation and normalization for UI comparison inventories.
 *
 * JSON Schema remains the structural source of truth. The additional checks
 * below cover relationships JSON Schema cannot express in draft-07, such as
 * bounds staying inside the concrete image and undeclared overlap between two
 * sibling elements.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(SKILL_ROOT, "../..");
const INVENTORY_SCHEMA_PATH = path.join(SKILL_ROOT, "schemas/ui-inventory.schema.json");
const PROFILE_SCHEMA_PATH = path.join(SKILL_ROOT, "schemas/comparison-profile.schema.json");
const DESIGN_SCHEMA_PATH = path.join(REPO_ROOT, "docs/architecture/schemas/design-artifact.schema.json");
const require = createRequire(import.meta.url);

export const UI_COMPARE_TOOL_CONTRACT_VERSION = "2.0.0";
export const UI_COMPARE_CAPTURE_ALGORITHM_VERSION = "2.0.0";
export const UI_COMPARISON_PROFILE_SCHEMA_ID = "https://cubica.local/schemas/ui-comparison-profile.v2.json";

let validators;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getValidators() {
  if (validators) return validators;
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    // The general ADR-016 schema uses these standard formats. Structural
    // validation here does not need an extra format plugin, so Ajv treats them
    // as already-known annotations instead of printing warnings.
    formats: { uri: true, "date-time": true },
  });
  const designSchema = readJson(DESIGN_SCHEMA_PATH);
  const inventorySchema = readJson(INVENTORY_SCHEMA_PATH);
  const profileSchema = readJson(PROFILE_SCHEMA_PATH);
  ajv.addSchema(designSchema);
  ajv.addSchema(inventorySchema);
  validators = {
    inventory: ajv.getSchema(inventorySchema.$id),
    profile: ajv.compile(profileSchema),
  };
  return validators;
}

export function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * Resolve a package from the consuming project first. Profiles record this
 * version because browser rendering can drift without any skill-file change.
 */
export function installedPackageVersion(packageName) {
  for (const base of [process.cwd(), REPO_ROOT, SKILL_ROOT]) {
    try {
      const packagePath = require.resolve(`${packageName}/package.json`, { paths: [base] });
      return readJson(packagePath).version;
    } catch {
      // Try the next project-relative resolution root.
    }
  }
  return "unknown";
}

export function schemaPaths() {
  return { inventory: INVENTORY_SCHEMA_PATH, profile: PROFILE_SCHEMA_PATH };
}

function inferredRole(region) {
  if (region.role) return region.role;
  const value = `${region.id || ""} ${region.type || ""}`.toLowerCase();
  if (/background|backdrop|фон/.test(value)) return "background";
  if (/decor|ornament|shadow|divider|декор/.test(value)) return "decor";
  if (/container|panel|section|layout|surface/.test(value)) return "container";
  if (/button|input|control|link|toggle|slider|checkbox|select|tab/.test(value)) return "control";
  if (/text|title|label|caption|heading|paragraph/.test(value)) return "text";
  if (/image|icon|avatar|video|canvas|map|board/.test(value)) return "media";
  return "content";
}

function rawRegions(raw) {
  if (Array.isArray(raw)) return raw;
  return raw.regions || [];
}

function visitRawRegions(regions, visitor) {
  for (const region of regions || []) {
    visitor(region);
    visitRawRegions(region.elements, visitor);
  }
}

/**
 * Flatten arbitrarily nested regions while preserving semantic ownership.
 * A stable qualified id is used for diagnostics, while local ids still have
 * to be globally unique in validated inventories.
 */
export function flattenRegionSpec(raw, skipped = []) {
  const flat = [];
  function visit(region, parentId = null, ancestors = []) {
    const localId = String(region.id || `unnamed-${flat.length + skipped.length + 1}`);
    const qualifiedId = parentId ? `${parentId}/${localId}` : localId;
    const bounds = region.bounds
      ? { x: region.bounds.x, y: region.bounds.y, w: region.bounds.width, h: region.bounds.height }
      : (Number.isFinite(region.x) && Number.isFinite(region.y) && Number.isFinite(region.w) && Number.isFinite(region.h)
        ? { x: region.x, y: region.y, w: region.w, h: region.h }
        : null);
    const children = Array.isArray(region.elements) ? region.elements : [];
    if (bounds) {
      flat.push({
        id: qualifiedId,
        localId,
        parentId,
        ancestors,
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: bounds.h,
        selector: region.selector,
        type: region.type,
        role: inferredRole(region),
        layer: Number.isInteger(region.layer) ? region.layer : 0,
        overlaps: Array.isArray(region.overlaps) ? region.overlaps : [],
        allowDominant: region.allowDominant === true,
        childCount: children.length,
      });
    } else {
      skipped.push(qualifiedId);
    }
    for (const child of children) visit(child, qualifiedId, [...ancestors, qualifiedId]);
  }
  for (const region of rawRegions(raw)) visit(region);
  return flat;
}

export function inventoryCanvas(raw, imageSize) {
  if (imageSize) return imageSize;
  if (raw.canvas) return { width: raw.canvas.width, height: raw.canvas.height };
  const dimensions = raw.image?.dimensions;
  return dimensions ? { width: dimensions.width, height: dimensions.height } : null;
}

export function inventorySource(raw) {
  return raw.source || raw.provenance || null;
}

function formatAjvErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message}`);
}

function overlapRatio(a, b) {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const intersection = width * height;
  return intersection / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
}

/**
 * Validate a strict inventory and then enforce image-dependent invariants.
 */
export function validateInventoryDocument(raw, options = {}) {
  const { inventory } = getValidators();
  const errors = [];
  const warnings = [];
  const structurallyValid = inventory(raw);
  if (!structurallyValid) errors.push(...formatAjvErrors(inventory.errors));

  const skipped = [];
  const regions = flattenRegionSpec(raw, skipped);
  const canvas = inventoryCanvas(raw, options.imageSize);
  if (!canvas) errors.push("Не заданы размеры изображения: canvas или image.dimensions");
  if (skipped.length) errors.push(`У зон отсутствуют bounds: ${skipped.join(", ")}`);

  // Version 1 remains extensible for design artifacts, but standalone
  // inventories warn about misspelled fields instead of silently accepting
  // them. A later schema version can turn these warnings into hard failures.
  if (raw?.$schema === "https://cubica.local/schemas/ui-comparison-inventory.v1.json") {
    const knownRegionKeys = new Set([
      "id", "type", "role", "layer", "bounds", "description", "selector",
      "overlaps", "allowDominant", "elements",
    ]);
    visitRawRegions(raw.regions, (region) => {
      const unknown = Object.keys(region).filter((key) => !knownRegionKeys.has(key));
      if (unknown.length) warnings.push(`Регион ${region.id || "<без id>"}: неизвестные поля ${unknown.join(", ")}`);
    });
  }

  const localIds = new Set();
  const selectors = new Map();
  for (const region of regions) {
    if (localIds.has(region.localId)) errors.push(`Повторяется id региона: ${region.localId}`);
    localIds.add(region.localId);
    if (region.selector) {
      if (selectors.has(region.selector)) {
        errors.push(`Один selector назначен нескольким регионам: ${region.selector}`);
      }
      selectors.set(region.selector, region.id);
    }
    if (canvas) {
      const inside = region.x >= 0 && region.y >= 0 && region.w > 0 && region.h > 0 &&
        region.x + region.w <= canvas.width && region.y + region.h <= canvas.height;
      if (!inside) errors.push(`Регион ${region.id} выходит за ${canvas.width}x${canvas.height}`);
      const share = (region.w * region.h) / (canvas.width * canvas.height);
      const semantic = !["background", "container", "decor"].includes(region.role);
      const leaf = region.childCount === 0;
      if (semantic && leaf && share > (options.maxDominantShare ?? 0.65) && !region.allowDominant) {
        errors.push(
          `Смысловой регион ${region.id} занимает ${(share * 100).toFixed(1)}% кадра; ` +
          "разбей его на элементы или явно укажи allowDominant"
        );
      }
    }
  }

  const semanticLeaves = regions.filter((region) =>
    !["background", "container", "decor"].includes(region.role) && region.childCount === 0
  );
  if (semanticLeaves.length === 0) errors.push("Нет ни одного отдельного смыслового элемента");

  for (let i = 0; i < semanticLeaves.length; i++) {
    for (let j = i + 1; j < semanticLeaves.length; j++) {
      const a = semanticLeaves[i];
      const b = semanticLeaves[j];
      if (a.ancestors.includes(b.id) || b.ancestors.includes(a.id)) continue;
      if (overlapRatio(a, b) < 0.2) continue;
      const declared = a.overlaps.includes(b.localId) || a.overlaps.includes(b.id) ||
        b.overlaps.includes(a.localId) || b.overlaps.includes(a.id);
      if (!declared) {
        errors.push(`Перекрытие ${a.id} и ${b.id} не объявлено в overlaps`);
      }
    }
  }

  const source = inventorySource(raw);
  if (!source) {
    errors.push("Не указано происхождение образца: source или provenance");
  } else if (source.usageRights === "unknown") {
    errors.push("Права использования образца неизвестны");
  } else if (options.mode === "pixel-parity" && !["owned", "licensed", "authorized"].includes(source.usageRights)) {
    errors.push("pixel-parity разрешён только для собственного, лицензированного или явно разрешённого образца");
  }
  if (source && !source.uri) warnings.push("Происхождение образца не содержит uri или локальный путь");
  if (source?.usageRights === "licensed" && (!source.license || !source.uri)) {
    errors.push("licensed требует указать license и uri источника");
  }
  if (source?.usageRights === "authorized" && !source.uri && !source.notes) {
    errors.push("authorized требует uri разрешения/источника или пояснение в notes");
  }

  if (Array.isArray(raw)) warnings.push("Устаревший массив регионов не является проверяемым инвентарём версии 1.0");
  return { valid: errors.length === 0, errors, warnings, regions, semanticLeaves, canvas, source };
}

export function validateProfileDocument(raw) {
  const { profile } = getValidators();
  const structurallyValid = profile(raw);
  const errors = structurallyValid ? [] : formatAjvErrors(profile.errors);
  const names = new Set();
  for (const viewport of raw.viewports || []) {
    if (names.has(viewport.name)) errors.push(`Повторяется имя viewport: ${viewport.name}`);
    names.add(viewport.name);
    if (Boolean(viewport.referencePath) !== Boolean(viewport.referenceSha256)) {
      errors.push(`Viewport ${viewport.name}: referencePath и referenceSha256 задаются вместе`);
    }
  }
  if (raw.mode === "pixel-parity" && !(raw.viewports || []).some((viewport) => viewport.referencePath)) {
    errors.push("pixel-parity требует хотя бы один viewport с эталоном");
  }
  return { valid: errors.length === 0, errors };
}

export function validateProfileArtifacts(raw, toolPath) {
  const errors = [];
  const warnings = [];
  const entries = [
    ["reference", raw.reference],
    ["inventory", raw.inventory],
    ...(raw.viewports || [])
      .filter((viewport) => viewport.referencePath)
      .map((viewport) => [`viewport ${viewport.name}`, {
        path: viewport.referencePath,
        sha256: viewport.referenceSha256,
      }]),
  ];
  for (const [label, entry] of entries) {
    if (!entry?.path || !fs.existsSync(entry.path)) {
      errors.push(`Не найден файл ${label}: ${entry?.path}`);
    } else if (sha256File(entry.path) !== entry.sha256) {
      errors.push(`Изменился файл ${label}: SHA-256 не совпадает`);
    }
  }
  if (raw.tool?.contractVersion !== UI_COMPARE_TOOL_CONTRACT_VERSION) {
    errors.push(`Изменилась версия контракта инструмента: ${raw.tool?.contractVersion}`);
  }
  if (raw.tool?.captureAlgorithmVersion !== UI_COMPARE_CAPTURE_ALGORITHM_VERSION) {
    errors.push(`Изменилась версия алгоритма захвата: ${raw.tool?.captureAlgorithmVersion}`);
  }
  const currentPlaywright = installedPackageVersion("playwright");
  if (raw.tool?.playwright !== currentPlaywright) {
    errors.push(`Изменилась версия Playwright: профиль=${raw.tool?.playwright}, среда=${currentPlaywright}`);
  }
  if (raw.tool?.platform !== process.platform || raw.tool?.arch !== process.arch) {
    const message = `Изменилась платформа: профиль=${raw.tool?.platform}/${raw.tool?.arch}, среда=${process.platform}/${process.arch}`;
    if (raw.mode === "pixel-parity") errors.push(message);
    else warnings.push(message);
  }
  if (raw.tool?.node !== process.version) {
    warnings.push(`Изменилась версия Node.js: профиль=${raw.tool?.node}, среда=${process.version}`);
  }
  if (toolPath && raw.tool?.scriptSha256 !== sha256File(toolPath)) {
    warnings.push("Изменился файл инструмента, но версии контракта и алгоритма совпадают");
  }
  return { errors, warnings };
}

export function readAndValidateProfile(filePath, toolPath) {
  const raw = readJson(filePath);
  const result = validateProfileDocument(raw);
  const artifacts = validateProfileArtifacts(raw, toolPath);
  const errors = [...result.errors, ...artifacts.errors];
  if (errors.length) throw new Error(`Профиль не прошёл проверку:\n- ${errors.join("\n- ")}`);
  for (const warning of artifacts.warnings) console.warn(`ВНИМАНИЕ ПРОФИЛЯ: ${warning}`);
  return raw;
}

export function viewportFromProfile(profile, name) {
  const selected = name
    ? profile.viewports.find((viewport) => viewport.name === name)
    : profile.viewports[0];
  if (!selected) throw new Error(`В профиле нет viewport "${name}"`);
  return selected;
}
