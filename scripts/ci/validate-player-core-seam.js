#!/usr/bin/env node
/**
 * Проверяет чистоту шва будущего клиентского ядра (ADR-064).
 *
 * «Шов» — это граница внутри apps/player-web, по которой в будущем будет
 * извлечён framework-agnostic пакет player-core (см. триггеры в ADR-064):
 * - apps/player-web/src/presenter/ — presenter-слой и runtime-клиент;
 * - apps/player-web/src/lib/      — резолверы контента, роутер экранов, выражения;
 * - packages/view-protocol/       — Abstract View Protocol и патч-утилиты.
 *
 * Правило: эти каталоги не должны импортировать React/Next/DOM-рендерные
 * пакеты. Пока правило выполняется, извлечение ядра остаётся механическим
 * переносом файлов, а не переписыванием под давлением сроков.
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

// Каталоги, входящие в шов ядра (проверяются рекурсивно).
const seamRoots = [
  "apps/player-web/src/presenter",
  "apps/player-web/src/lib",
  "packages/view-protocol/src"
];

// Запрещённые для ядра модули: UI-фреймворк и фреймворк приложения.
// Импорт любого из них (или их подпутей, например "next/navigation")
// означает, что framework-specific код просочился за шов.
const forbiddenModules = ["react", "react-dom", "next"];

const scannedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walkFiles(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) {
    return [];
  }
  const files = [];
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (scannedExtensions.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  }
  return files;
}

// Ловим статические импорты, re-export и require с запрещённым модулем.
// Матчим точное имя модуля или его подпуть ("react", "react/jsx-runtime", "next/link").
function findForbiddenImports(source) {
  const importPattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
  const bareImportPattern = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  const found = [];
  for (const pattern of [importPattern, bareImportPattern]) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1];
      const isForbidden = forbiddenModules.some(
        (moduleName) => specifier === moduleName || specifier.startsWith(`${moduleName}/`)
      );
      if (isForbidden) {
        found.push(specifier);
      }
    }
  }
  return found;
}

function main() {
  const failures = [];

  for (const seamRoot of seamRoots) {
    const absoluteRoot = path.join(repoRoot, seamRoot);
    if (!fs.existsSync(absoluteRoot)) {
      failures.push(`seam root '${seamRoot}' does not exist (ADR-064 seam layout changed?)`);
      continue;
    }
    for (const filePath of walkFiles(absoluteRoot)) {
      const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, "/");
      const source = fs.readFileSync(filePath, "utf8");
      for (const specifier of findForbiddenImports(source)) {
        failures.push(`${relativePath}: forbidden framework import '${specifier}'`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("validate-player-core-seam: seam violations found (ADR-064):");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("validate-player-core-seam: OK (presenter/lib/view-protocol are framework-free)");
}

main();
