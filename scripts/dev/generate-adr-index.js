#!/usr/bin/env node

/**
 * Builds the ADR catalogue from the decision records themselves.
 *
 * Keeping the index derived prevents its numbers, titles, and statuses from
 * silently drifting away from the architecture records that define them.
 */
const fs = require('fs');
const path = require('path');

const ADR_DIRECTORY = path.join(process.cwd(), 'docs/architecture/adrs');
const INDEX_PATH = path.join(ADR_DIRECTORY, 'INDEX.md');
const PM_REVIEW_NUMBERS = new Set(['012', '017', '018']);
const ADR_001_STATUS = 'Superseded by ADR-013 в части структуры манифестов.';

/** Reads every ADR Markdown file, including the numbered reusable template. */
function listAdrFiles() {
  return fs.readdirSync(ADR_DIRECTORY)
    .filter((fileName) => /^\d{3}-.+\.md$/.test(fileName))
    .sort();
}

/**
 * Returns the status field near the document header, where it is metadata,
 * rather than matching later prose that may discuss statuses of alternatives.
 */
function findStatus(content, fileName) {
  if (fileName.startsWith('001-')) {
    return ADR_001_STATUS;
  }

  const lines = content.split(/\r?\n/);
  const headerLines = lines.slice(0, 40);

  for (let index = 0; index < headerLines.length; index += 1) {
    const line = headerLines[index];
    if (/^## Status\s*$/.test(line)) {
      const value = headerLines.slice(index + 1).find((candidate) => candidate.trim() !== '');
      if (value) return value.trim();
    }

    const match = line.match(/^(?:-\s*)?(?:\*\*(?:Status|Статус):\*\*|\*\*(?:Status|Статус)\*\*:|(?:Status|Статус):)\s*(.+)$/);
    if (match) return match[1].trim();
  }

  throw new Error(`Cannot find an unambiguous status field in ${fileName}.`);
}

/** Extracts the published ADR number and title from its required first heading. */
function readAdr(fileName) {
  const content = fs.readFileSync(path.join(ADR_DIRECTORY, fileName), 'utf8');
  if (fileName === '000-template.md') {
    return {
      fileName,
      number: '000',
      title: 'Шаблон ADR',
      status: findStatus(content, fileName),
    };
  }
  // A historical record has a UTF-8 BOM before its heading; accept it without
  // rewriting unrelated document bytes.
  const titleMatch = content.match(/^\uFEFF?# ADR[- ](\d{3}):\s+(.+)$/m);
  if (!titleMatch) {
    throw new Error(`Cannot find the ADR heading in ${fileName}.`);
  }

  return {
    fileName,
    number: titleMatch[1],
    title: titleMatch[2],
    status: findStatus(content, fileName),
  };
}

/** Rewrites only header status markup; ADR-001 also receives its accepted correction. */
function normalizeStatus(content, fileName) {
  if (fileName.startsWith('001-')) {
    const corrected = content
      .replace(/^> \*\*Статус:\*\* .*$/m, `**Status:** ${ADR_001_STATUS}`)
      .replace(/^- \*\*Статус\*\*: Proposed\r?\n/m, '');
    return corrected;
  }

  const lines = content.split(/(\r?\n)/);
  const headerLimit = Math.min(lines.length, 80);
  for (let index = 0; index < headerLimit; index += 2) {
    const line = lines[index];
    if (/^## Status\s*$/.test(line)) {
      let valueIndex = index + 2;
      while (valueIndex < lines.length && lines[valueIndex].trim() === '') valueIndex += 2;
      if (valueIndex >= lines.length) throw new Error(`Missing Status value in ${fileName}.`);
      const value = lines[valueIndex].trim();
      lines.splice(index, valueIndex - index + 1, `**Status:** ${value}`, lines[index + 1] || '\n');
      return lines.join('');
    }

    const match = line.match(/^(?:-\s*)?(?:\*\*(?:Status|Статус):\*\*|\*\*(?:Status|Статус)\*\*:|(?:Status|Статус):)\s*(.+)$/);
    if (match) {
      lines[index] = `**Status:** ${match[1].trim()}`;
      return lines.join('');
    }
  }

  throw new Error(`Cannot normalize an unambiguous status field in ${fileName}.`);
}

function buildIndex(records) {
  const rows = records.map(({ fileName, number, title, status }) =>
    `| [ADR-${number}](${fileName}) | ${title.replace(/\|/g, '\\|')} | ${status.replace(/\|/g, '\\|')} |`,
  );
  const pmRecords = records.filter(({ number }) => PM_REVIEW_NUMBERS.has(number));

  return `<!-- AUTO-GENERATED: do not edit manually. Run node scripts/dev/generate-adr-index.js. -->
# ADR index

This catalogue is generated from the ADR headers. Status values describe the current state of each architecture decision.

## PM review required

The following proposed decisions require explicit product-manager review before they can become binding architecture.

${pmRecords.map(({ fileName, number, title, status }) => `- [ADR-${number}: ${title}](${fileName}) — ${status}`).join('\n')}

## All ADRs

| ADR | Title | Status |
| --- | --- | --- |
${rows.join('\n')}
`;
}

function main() {
  const check = process.argv.includes('--check');
  const files = listAdrFiles();
  const normalized = files.map((fileName) => ({
    fileName,
    content: normalizeStatus(fs.readFileSync(path.join(ADR_DIRECTORY, fileName), 'utf8'), fileName),
  }));
  const hasUnnormalizedStatus = normalized.some(({ fileName, content }) =>
    content !== fs.readFileSync(path.join(ADR_DIRECTORY, fileName), 'utf8'),
  );

  if (check && hasUnnormalizedStatus) {
    throw new Error('ADR status markup is stale; run node scripts/dev/generate-adr-index.js.');
  }
  if (!check) {
    for (const { fileName, content } of normalized) {
      fs.writeFileSync(path.join(ADR_DIRECTORY, fileName), content);
    }
  }

  const index = buildIndex(files.map(readAdr));
  const currentIndex = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '';
  if (check) {
    if (currentIndex !== index) throw new Error('ADR index is stale; run node scripts/dev/generate-adr-index.js.');
    console.log(`ADR index matches ${files.length} records.`);
    return;
  }

  fs.writeFileSync(INDEX_PATH, index);
  console.log(`ADR index generated for ${files.length} records.`);
}

main();
