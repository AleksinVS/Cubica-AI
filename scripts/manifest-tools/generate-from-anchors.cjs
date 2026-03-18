#!/usr/bin/env node

/**
 * Генератор текстовых проекций для логического манифеста.
 *
 * Скрипт читает текстовые файлы (rules/scenario/methodology),
 * извлекает комментарии-якоря вида:
 *
 *   <!-- anchor: game.screen.intro.title -->
 *
 * и заполняет/обновляет поля `resolved` и `format` в объектах
 * вида:
 *
 *   {
 *     "source_ref": { "file": "rules", "anchor": "game.screen.intro.title" },
 *     "resolved": "...",
 *     "format": "markdown"
 *   }
 *
 * внутри JSON-манифеста.
 *
 * Использование (из корня репозитория):
 *
 *   node scripts/manifest-tools/generate-from-anchors.cjs \
 *     --manifest games/antarctica-nextjs-player/src/app/data/antarctica/logic-sample.json \
 *     --rules games/antarctica-nextjs-player/src/app/data/antarctica/rules-sample.md \
 *     --schema docs/architecture/schemas/game-manifest.schema.json
 *
 * Параметры:
 *   --manifest <path>                путь к логическому манифесту (JSON)
 *   --rules <path>                   путь к файлу правил (source_ref.file = "rules")
 *   --scenario <path>                путь к файлу сценария (source_ref.file = "scenario")
 *   --methodology-participants <path> путь к материалам для участников (source_ref.file = "methodology.participants")
 *   --methodology-facilitators <path> путь к материалам для ведущих (source_ref.file = "methodology.facilitators")
 *   --schema <path>                  путь к JSON Schema для валидации
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--')) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.warn(`[generate-from-anchors] Не удалось прочитать файл: ${filePath} (${error.message})`);
    return null;
  }
}

/**
 * Извлекает якоря и связанные с ними текстовые блоки из файла.
 * Подход простой: берём все строки после комментария-якоря или заголовка
 * с Markdown ID (`### Title {#anchor}`) до следующего якоря или конца файла.
 */
function extractAnchorsFromText(sourceText) {
  const lines = sourceText.split(/\r?\n/);
  const commentAnchorPattern = /<!--\s*anchor:\s*([^\s]+)\s*-->/i;
  const headingAnchorPattern = /^(\s*#{1,6})\s+(.+?)\s*\{#([a-zA-Z0-9_.:-]+)\}\s*$/;
  const anchors = {};
  const markers = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const commentMatch = line.match(commentAnchorPattern);
    if (commentMatch) {
      markers.push({ index: lineIndex, anchorId: commentMatch[1], type: 'comment' });
      continue;
    }

    const headingMatch = line.match(headingAnchorPattern);
    if (headingMatch) {
      markers.push({
        index: lineIndex,
        anchorId: headingMatch[3],
        type: 'heading',
        headingPrefix: headingMatch[1],
        headingText: headingMatch[2],
      });
    }
  }

  for (let markerIndex = 0; markerIndex < markers.length; markerIndex += 1) {
    const marker = markers[markerIndex];
    const nextMarker = markers[markerIndex + 1];
    const endIndex = nextMarker ? nextMarker.index : lines.length;
    const collectedLines = [];
    const startIndex = marker.index + 1;

    if (marker.type === 'heading') {
      const headingLine = `${marker.headingPrefix} ${marker.headingText}`.trim();
      collectedLines.push(headingLine);
    }

    for (let cursor = startIndex; cursor < endIndex; cursor += 1) {
      collectedLines.push(lines[cursor]);
    }

    const body = collectedLines.join('\n').trim();
    if (anchors[marker.anchorId]) {
      console.warn(`[generate-from-anchors] Якорь "${marker.anchorId}" переопределён последним вхождением.`);
    }
    anchors[marker.anchorId] = body;
  }

  return anchors;
}

function detectFormatFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.md') {
    return 'markdown';
  }
  if (extension === '.html' || extension === '.htm') {
    return 'html';
  }
  return 'plain';
}

function buildAnchorIndex(sourceFilesConfig) {
  const index = {};

  for (const [fileKey, filePath] of Object.entries(sourceFilesConfig)) {
    if (!filePath) continue;
    const absolutePath = path.resolve(filePath);
    const text = readFileSafe(absolutePath);
    if (text == null) continue;

    const anchors = extractAnchorsFromText(text);
    const format = detectFormatFromPath(filePath);

    Object.entries(anchors).forEach(([anchorId, body]) => {
      const compositeKey = `${fileKey}:${anchorId}`;
      index[compositeKey] = { text: body, format };
    });
  }

  return index;
}

function updateLocalizedTextNode(node, anchorIndex, missingAnchors) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (!node.source_ref || typeof node.source_ref !== 'object') {
    return;
  }

  const { file, anchor } = node.source_ref;
  if (typeof file !== 'string' || typeof anchor !== 'string') {
    return;
  }

  const anchorKey = `${file}:${anchor}`;
  const entry = anchorIndex[anchorKey];

  if (!entry) {
    missingAnchors.add(anchorKey);
    return;
  }

  // Обновляем кэшированный текст и формат.
  node.resolved = entry.text;
  if (!node.format) {
    node.format = entry.format;
  }
}

function traverseAndUpdate(node, anchorIndex, missingAnchors) {
  if (!node || typeof node !== 'object') {
    return;
  }

  // Попытаться трактовать узел как локализованный текст.
  updateLocalizedTextNode(node, anchorIndex, missingAnchors);

  if (Array.isArray(node)) {
    node.forEach((item) => traverseAndUpdate(item, anchorIndex, missingAnchors));
    return;
  }

  Object.values(node).forEach((value) => {
    if (value && typeof value === 'object') {
      traverseAndUpdate(value, anchorIndex, missingAnchors);
    }
  });
}

/**
 * Валидирует манифест по JSON Schema.
 */
function validateManifest(manifest, schemaPath) {
  const absoluteSchemaPath = path.resolve(schemaPath);
  const schemaRaw = readFileSafe(absoluteSchemaPath);
  if (schemaRaw == null) {
    console.error(`[generate-from-anchors] Ошибка: не удалось прочитать JSON Schema ${schemaPath}`);
    return false;
  }

  let schemaJson;
  try {
    schemaJson = JSON.parse(schemaRaw);
  } catch (error) {
    console.error(`[generate-from-anchors] Некорректный JSON Schema ${schemaPath}: ${error.message}`);
    return false;
  }

  const ajv = new Ajv({ allErrors: true, schemaId: 'auto' });
  const validate = ajv.compile(schemaJson);
  const valid = validate(manifest);

  if (!valid) {
    console.error(`[generate-from-anchors] Манифест не проходит валидацию по схеме ${schemaPath}`);
    console.error(JSON.stringify(validate.errors, null, 2));
  }

  return Boolean(valid);
}

function main() {
  const args = parseArgs(process.argv);
  const manifestPath = args['--manifest'];
  const schemaPath = args['--schema'] || 'docs/architecture/schemas/game-manifest.schema.json';

  if (!manifestPath) {
    console.error('[generate-from-anchors] Ошибка: требуется параметр --manifest <path>');
    process.exitCode = 1;
    return;
  }

  const sourceFilesConfig = {
    rules: args['--rules'],
    scenario: args['--scenario'],
    'methodology.participants': args['--methodology-participants'],
    'methodology.facilitators': args['--methodology-facilitators'],
  };

  const anchorIndex = buildAnchorIndex(sourceFilesConfig);

  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestRaw = readFileSafe(absoluteManifestPath);
  if (manifestRaw == null) {
    process.exitCode = 1;
    return;
  }

  let manifestJson;
  try {
    manifestJson = JSON.parse(manifestRaw);
  } catch (error) {
    console.error(`[generate-from-anchors] Некорректный JSON в манифесте ${manifestPath}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const missingAnchors = new Set();
  traverseAndUpdate(manifestJson, anchorIndex, missingAnchors);

  if (missingAnchors.size > 0) {
    console.error('[generate-from-anchors] Обнаружены отсутствующие якоря:');
    for (const missing of missingAnchors) {
      const [file, anchor] = missing.split(':');
      console.error(`  - file: "${file}", anchor: "${anchor}"`);
    }
    process.exitCode = 1;
    return;
  }

  if (!validateManifest(manifestJson, schemaPath)) {
    process.exitCode = 1;
    return;
  }

  const prettyJson = JSON.stringify(manifestJson, null, 2);
  fs.writeFileSync(absoluteManifestPath, prettyJson + '\n', 'utf8');

  console.log(`[generate-from-anchors] Обновлён манифест: ${manifestPath}`);
}

main();

