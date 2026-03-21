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
const TARGETED_LINE_INDEX = 0;
const TARGETED_STEP_INDEX = 9;

function runExtractor(args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [EXTRACTOR_PATH, ...args], {
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

function validateOpeningOutput(json) {
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

function validateTargetedOutput(json, expectedLineIndex, expectedStepIndex) {
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

  if (!data.selectedBlock || typeof data.selectedBlock !== 'object') {
    errors.push('Missing required field: selectedBlock');
  } else {
    if (data.selectedBlock.lineIndex !== expectedLineIndex) {
      errors.push(`selectedBlock.lineIndex must be ${expectedLineIndex}`);
    }
    if (data.selectedBlock.stepIndex !== expectedStepIndex) {
      errors.push(`selectedBlock.stepIndex must be ${expectedStepIndex}`);
    }
    if (!Array.isArray(data.selectedBlock.ids) || data.selectedBlock.ids.length === 0) {
      errors.push('selectedBlock.ids must be a non-empty array');
    }
  }

  if (!data.referencedEntries || typeof data.referencedEntries !== 'object') {
    errors.push('Missing required field: referencedEntries');
  }

  if (!data.context || typeof data.context !== 'object') {
    errors.push('Missing required field: context');
  } else {
    if (!data.context.previousStep || typeof data.context.previousStep !== 'object') {
      errors.push('context.previousStep must be an object for targeted step');
    }
    if (!data.context.nextStep || typeof data.context.nextStep !== 'object') {
      errors.push('context.nextStep must be an object for targeted step');
    }
  }

  if (!data.summary || typeof data.summary !== 'object') {
    errors.push('Missing required field: summary');
  } else {
    if (data.summary.lineIndex !== expectedLineIndex) {
      errors.push(`summary.lineIndex must be ${expectedLineIndex}`);
    }
    if (data.summary.stepIndex !== expectedStepIndex) {
      errors.push(`summary.stepIndex must be ${expectedStepIndex}`);
    }
  }

  const selectedIds = Array.isArray(data.selectedBlock && data.selectedBlock.ids)
    ? data.selectedBlock.ids.map(String)
    : [];
  for (const id of REQUIRED_BOARD_IDS) {
    if (!selectedIds.includes(id)) {
      errors.push(`selectedBlock.ids must include "${id}"`);
    }
  }

  if (data.referencedEntries && typeof data.referencedEntries === 'object') {
    for (const id of selectedIds) {
      if (!Object.prototype.hasOwnProperty.call(data.referencedEntries, id)) {
        errors.push(`referencedEntries must include metadata for selected id "${id}"`);
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

  let openingOutput;
  try {
    openingOutput = await runExtractor();
    console.log('  Opening extractor ran successfully');
  } catch (error) {
    console.error('FAILED:', error.message);
    process.exit(1);
  }

  const openingResult = validateOpeningOutput(openingOutput);

  if (openingResult.valid) {
    console.log('  Opening validation: PASSED');
    console.log('Opening flow summary:');
    console.log(`  Opening blocks: ${openingResult.data.openingBlocks.length}`);
    console.log(`  First board step: ${openingResult.data.firstBoard.stepIndex}`);
    console.log(`  First board ids: ${openingResult.data.firstBoard.ids.join(', ')}`);
    if (openingResult.data.summary) {
      console.log(`  Intro info blocks: ${openingResult.data.summary.introInfoBlockCount}`);
      console.log(`  Referenced metadata entries: ${openingResult.data.summary.referencedEntryCount}`);
    }
    if (openingResult.data.initialMetrics) {
      console.log('  Initial metrics:');
      for (const key of REQUIRED_METRICS) {
        const value = openingResult.data.initialMetrics[key];
        const name = openingResult.data.metricNames[key] || key;
        console.log(`    ${name} (${key}): ${value}`);
      }
    }
  } else {
    console.error('  Opening validation: FAILED');
    for (const err of openingResult.errors) {
      console.error(`    - ${err}`);
    }
    process.exit(1);
  }

  let targetedOutput;
  const targetedArgs = ['--line', String(TARGETED_LINE_INDEX), '--step', String(TARGETED_STEP_INDEX)];
  try {
    targetedOutput = await runExtractor(targetedArgs);
    console.log('\n  Targeted extractor ran successfully');
  } catch (error) {
    console.error('FAILED:', error.message);
    process.exit(1);
  }

  const targetedResult = validateTargetedOutput(
    targetedOutput,
    TARGETED_LINE_INDEX,
    TARGETED_STEP_INDEX
  );

  if (!targetedResult.valid) {
    console.error('  Targeted validation: FAILED');
    for (const err of targetedResult.errors) {
      console.error(`    - ${err}`);
    }
    process.exit(1);
  }

  console.log('  Targeted validation: PASSED');
  console.log(`  Selected block type: ${targetedResult.data.selectedBlock.blockType}`);
  console.log(`  Selected ids: ${targetedResult.data.selectedBlock.ids.join(', ')}`);
  console.log(`  Previous step index: ${targetedResult.data.context.previousStep.stepIndex}`);
  console.log(`  Next step index: ${targetedResult.data.context.nextStep.stepIndex}`);
  process.exit(0);
}

main();
