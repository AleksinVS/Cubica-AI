#!/usr/bin/env node
/**
 * Verifies Antarctica extraction output.
 *
 * Checks:
 * - extractor CLI runs successfully
 * - output is valid JSON
 * - required summary structure exists
 * - first board contains card ids 1..6
 */

const { spawn } = require('child_process');
const path = require('path');

const EXTRACTOR_PATH = path.resolve(__dirname, 'extract-opening.js');
const REQUIRED_METRICS = ['pro', 'rep', 'lid', 'man', 'stat', 'cont', 'constr', 'time'];
const REQUIRED_BOARD_IDS = ['1', '2', '3', '4', '5', '6'];

function runExtractor() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [EXTRACTOR_PATH], {
      cwd: path.resolve(__dirname, '../..')
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Extractor exited with code ${code}. stderr: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
    
    proc.on('error', (err) => {
      reject(new Error(`Failed to run extractor: ${err.message}`));
    });
  });
}

function validateOutput(json) {
  const errors = [];

  let data;
  try {
    data = JSON.parse(json);
  } catch (error) {
    errors.push(`Invalid JSON: ${error.message}`);
    return { valid: false, errors, data: null };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('Root output must be an object');
    return { valid: false, errors, data: null };
  }

  if (!data.initialMetrics || typeof data.initialMetrics !== 'object') {
    errors.push('Missing required field: initialMetrics');
  } else {
    for (const metric of REQUIRED_METRICS) {
      if (typeof data.initialMetrics[metric] !== 'number') {
        errors.push(`Metric "${metric}" must be a number`);
      }
    }
  }

  if (!data.metricNames || typeof data.metricNames !== 'object') {
    errors.push('Missing required field: metricNames');
  }

  if (!Array.isArray(data.openingBlocks) || data.openingBlocks.length === 0) {
    errors.push('openingBlocks must be a non-empty array');
  }

  if (!data.firstBoard || typeof data.firstBoard !== 'object') {
    errors.push('Missing required field: firstBoard');
  }

  if (!data.referencedEntries || typeof data.referencedEntries !== 'object') {
    errors.push('Missing required field: referencedEntries');
  }

  if (!data.summary || typeof data.summary !== 'object') {
    errors.push('Missing required field: summary');
  }

  if (Array.isArray(data.openingBlocks)) {
    for (let i = 0; i < data.openingBlocks.length; i++) {
      const block = data.openingBlocks[i];
      if (!block || typeof block !== 'object') {
        errors.push(`openingBlocks[${i}] must be an object`);
        continue;
      }
      if (typeof block.lineIndex !== 'number') {
        errors.push(`openingBlocks[${i}].lineIndex must be a number`);
      }
      if (typeof block.stepIndex !== 'number') {
        errors.push(`openingBlocks[${i}].stepIndex must be a number`);
      }
      if (!Array.isArray(block.ids) || block.ids.length === 0) {
        errors.push(`openingBlocks[${i}].ids must be a non-empty array`);
      }
    }
  }

  const boardIds = Array.isArray(data.firstBoard && data.firstBoard.ids)
    ? data.firstBoard.ids.map(String)
    : [];
  for (const id of REQUIRED_BOARD_IDS) {
    if (!boardIds.includes(id)) {
      errors.push(`firstBoard.ids must include "${id}"`);
    }
  }

  if (Array.isArray(data.openingBlocks)) {
    const foundBoardInOpening = data.openingBlocks.some((block) => {
      if (!block || !Array.isArray(block.ids)) {
        return false;
      }
      const ids = block.ids.map(String);
      return REQUIRED_BOARD_IDS.every((id) => ids.includes(id));
    });
    if (!foundBoardInOpening) {
      errors.push('openingBlocks does not include a block with ids 1..6');
    }
  }

  if (data.referencedEntries && typeof data.referencedEntries === 'object') {
    for (const id of REQUIRED_BOARD_IDS) {
      if (!Object.prototype.hasOwnProperty.call(data.referencedEntries, id)) {
        errors.push(`referencedEntries must include metadata for card "${id}"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data
  };
}

async function main() {
  console.log('Verifying Antarctica extraction tooling...\n');
  console.log(`  Extractor path: ${EXTRACTOR_PATH}`);

  let output;
  try {
    output = await runExtractor();
    console.log('  Extractor ran successfully\n');
  } catch (error) {
    console.error('FAILED:', error.message);
    process.exit(1);
  }

  const result = validateOutput(output);

  if (result.valid) {
    console.log('  Validation: PASSED\n');
    console.log('Opening flow summary:');
    console.log(`  Opening blocks: ${result.data.openingBlocks.length}`);
    console.log(`  First board step: ${result.data.firstBoard.stepIndex}`);
    console.log(`  First board ids: ${result.data.firstBoard.ids.join(', ')}`);
    if (result.data.summary) {
      console.log(`  Intro info blocks: ${result.data.summary.introInfoBlockCount}`);
      console.log(`  Referenced metadata entries: ${result.data.summary.referencedEntryCount}`);
    }
    if (result.data.initialMetrics) {
      console.log('  Initial metrics:');
      for (const key of REQUIRED_METRICS) {
        const value = result.data.initialMetrics[key];
        const name = result.data.metricNames[key] || key;
        console.log(`    ${name} (${key}): ${value}`);
      }
    }
    process.exit(0);
  } else {
    console.error('  Validation: FAILED');
    for (const err of result.errors) {
      console.error(`    - ${err}`);
    }
    process.exit(1);
  }
}

main();
