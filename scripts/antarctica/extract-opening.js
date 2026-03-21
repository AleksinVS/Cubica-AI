#!/usr/bin/env node
/**
 * Antarctica opening extractor.
 *
 * Reads `draft/Antarctica/Game.html`, extracts only:
 * - `var cardsObj = { ... };`
 * - `game = { ... };`
 *
 * Extraction is done with balanced-brace scanning (no nested-regex parsing).
 * Then only those two object literals are evaluated in a VM sandbox with
 * function stubs required by action tuples.
 *
 * Usage:
 *   node scripts/antarctica/extract-opening.js [--input <path>]
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEFAULT_INPUT = path.resolve(__dirname, '../../draft/Antarctica/Game.html');
const METRIC_KEYS = ['pro', 'rep', 'lid', 'man', 'stat', 'cont', 'constr', 'time'];
const REQUIRED_BOARD_IDS = ['1', '2', '3', '4', '5', '6'];

const METRIC_NAMES = {
  pro: 'progress',
  rep: 'reputation',
  lid: 'leadership',
  man: 'management',
  stat: 'strategy',
  cont: 'contacts',
  constr: 'construction',
  time: 'time'
};

const STUB_FUNCTION_NAMES = ['goTo', 'swap', 'unlock', 'f34', 'f25_30', 'unlock39'];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: DEFAULT_INPUT };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      opts.input = args[++i];
    }
  }
  return opts;
}

function createStubFunction(name) {
  const stub = function cubicaActionStub() {
    throw new Error(`Function stub "${name}" must not execute during extraction`);
  };
  Object.defineProperty(stub, '__symbolicName', {
    value: name,
    enumerable: false,
    writable: false
  });
  return stub;
}

function buildSandbox(extra = {}) {
  const sandbox = { ...extra };
  for (const name of STUB_FUNCTION_NAMES) {
    sandbox[name] = createStubFunction(name);
  }
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function findMatchingBrace(source, openBraceIndex, label) {
  if (source[openBraceIndex] !== '{') {
    throw new Error(`${label}: expected "{" at index ${openBraceIndex}`);
  }

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      if (ch === '\\') {
        i++;
      } else if (ch === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inTemplateQuote) {
      if (ch === '\\') {
        i++;
      } else if (ch === '`') {
        inTemplateQuote = false;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === '`') {
      inTemplateQuote = true;
      continue;
    }

    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
      continue;
    }
  }

  throw new Error(`${label}: unmatched braces`);
}

function extractObjectLiteralByAssignment(source, markerRegex, label) {
  const markerMatch = markerRegex.exec(source);
  if (!markerMatch || markerMatch.index === undefined) {
    throw new Error(`Could not find ${label} assignment`);
  }

  const markerEnd = markerMatch.index + markerMatch[0].length;
  let openBraceIndex = markerEnd;
  while (openBraceIndex < source.length && /\s/.test(source[openBraceIndex])) {
    openBraceIndex++;
  }

  if (source[openBraceIndex] !== '{') {
    openBraceIndex = source.indexOf('{', markerEnd);
  }
  if (openBraceIndex < 0) {
    throw new Error(`${label}: opening "{" not found`);
  }

  const closeBraceIndex = findMatchingBrace(source, openBraceIndex, label);
  return source.slice(openBraceIndex, closeBraceIndex + 1);
}

function evaluateObjectLiteral(literalSource, sandbox, label) {
  try {
    return vm.runInContext(`(${literalSource})`, sandbox, {
      timeout: 2000
    });
  } catch (error) {
    throw new Error(`Failed to evaluate ${label}: ${error.message}`);
  }
}

function getFunctionSymbol(value) {
  if (value && typeof value === 'function') {
    if (typeof value.__symbolicName === 'string' && value.__symbolicName.length > 0) {
      return value.__symbolicName;
    }
    if (typeof value.name === 'string' && value.name.length > 0) {
      return value.name;
    }
  }
  return 'anonymous';
}

function serializeFunctionsToSymbols(value) {
  if (typeof value === 'function') {
    return {
      kind: 'functionRef',
      name: getFunctionSymbol(value)
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeFunctionsToSymbols(item));
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = serializeFunctionsToSymbols(value[key]);
    }
    return out;
  }

  return value;
}

function idsIncludeAll(ids, requiredIds) {
  const set = new Set(ids.map(String));
  return requiredIds.every((id) => set.has(id));
}

function collectOpeningBlocks(cardsObj, game) {
  if (!Array.isArray(game.timeline) || !Array.isArray(game.timeline[0])) {
    throw new Error('game.timeline[0] is missing or invalid');
  }

  const mainLine = game.timeline[0];
  const openingBlocks = [];
  let firstBoardBlock = null;

  for (let stepIndex = 0; stepIndex < mainLine.length; stepIndex++) {
    const rawStep = mainLine[stepIndex];
    if (!Array.isArray(rawStep)) {
      continue;
    }

    const ids = rawStep.map((id) => String(id));
    if (ids.length === 0) {
      continue;
    }

    const firstCard = cardsObj[ids[0]];
    const blockType = firstCard && typeof firstCard.type === 'string'
      ? firstCard.type
      : 'unknown';

    const block = {
      lineIndex: 0,
      stepIndex,
      blockType,
      ids
    };

    if (blockType === 'info') {
      block.title = firstCard && typeof firstCard.title === 'string'
        ? firstCard.title
        : '';
    }

    openingBlocks.push(block);

    if (!firstBoardBlock && idsIncludeAll(ids, REQUIRED_BOARD_IDS)) {
      firstBoardBlock = {
        lineIndex: 0,
        stepIndex,
        ids
      };
      break;
    }
  }

  if (!firstBoardBlock) {
    throw new Error('Could not find the first six-card board (ids 1..6) on main line');
  }

  return { openingBlocks, firstBoardBlock };
}

function collectReferencedMetadata(cardsObj, openingBlocks) {
  const referencedIds = new Set();
  for (const block of openingBlocks) {
    for (const id of block.ids) {
      referencedIds.add(String(id));
    }
  }

  const sortedIds = Array.from(referencedIds).sort((a, b) => {
    const aNum = Number(a);
    const bNum = Number(b);
    const aIsNum = Number.isFinite(aNum) && String(aNum) === a;
    const bIsNum = Number.isFinite(bNum) && String(bNum) === b;
    if (aIsNum && bIsNum) {
      return aNum - bNum;
    }
    if (aIsNum) {
      return -1;
    }
    if (bIsNum) {
      return 1;
    }
    return a.localeCompare(b);
  });

  const referencedEntries = {};
  for (const id of sortedIds) {
    if (!cardsObj[id]) {
      continue;
    }
    referencedEntries[id] = serializeFunctionsToSymbols(cardsObj[id]);
  }

  return referencedEntries;
}

function extractInitialMetrics(game) {
  const initialMetrics = {};
  for (const key of METRIC_KEYS) {
    const value = game[key];
    if (typeof value !== 'number') {
      throw new Error(`Missing numeric metric "${key}" in game object`);
    }
    initialMetrics[key] = value;
  }
  return initialMetrics;
}

function buildSummary(openingBlocks, firstBoardBlock, referencedEntries) {
  let introInfoBlocks = 0;
  for (const block of openingBlocks) {
    if (block.blockType === 'info') {
      introInfoBlocks++;
      continue;
    }
    break;
  }

  return {
    openingBlockCount: openingBlocks.length,
    introInfoBlockCount: introInfoBlocks,
    firstBoardStepIndex: firstBoardBlock.stepIndex,
    firstBoardIds: firstBoardBlock.ids,
    referencedEntryCount: Object.keys(referencedEntries).length
  };
}

function extractData(html, sourcePath) {
  const cardsLiteral = extractObjectLiteralByAssignment(
    html,
    /var\s+cardsObj\s*=\s*/m,
    'cardsObj'
  );
  const cardsSandbox = buildSandbox();
  const cardsObj = evaluateObjectLiteral(cardsLiteral, cardsSandbox, 'cardsObj literal');

  if (!cardsObj || typeof cardsObj !== 'object' || Array.isArray(cardsObj)) {
    throw new Error('cardsObj literal did not evaluate to an object');
  }

  const gameLiteral = extractObjectLiteralByAssignment(
    html,
    /\bgame\s*=\s*/m,
    'game'
  );
  const gameSandbox = buildSandbox({ cardsObj });
  const gameObj = evaluateObjectLiteral(gameLiteral, gameSandbox, 'game literal');

  if (!gameObj || typeof gameObj !== 'object' || Array.isArray(gameObj)) {
    throw new Error('game literal did not evaluate to an object');
  }

  const { openingBlocks, firstBoardBlock } = collectOpeningBlocks(cardsObj, gameObj);
  const referencedEntries = collectReferencedMetadata(cardsObj, openingBlocks);
  const initialMetrics = extractInitialMetrics(gameObj);

  return {
    sourceFile: sourcePath,
    initialMetrics,
    metricNames: METRIC_NAMES,
    openingBlocks,
    firstBoard: firstBoardBlock,
    referencedEntries,
    summary: buildSummary(openingBlocks, firstBoardBlock, referencedEntries)
  };
}

function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.input)) {
    console.error(`Input file not found: ${opts.input}`);
    process.exit(1);
  }

  let html;
  try {
    html = fs.readFileSync(opts.input, 'utf8');
  } catch (error) {
    console.error(`Failed to read input file: ${error.message}`);
    process.exit(1);
  }

  let result;
  try {
    result = extractData(html, opts.input);
  } catch (error) {
    console.error(`Extraction failed: ${error.message}`);
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
