const fs = require('fs');
const { PNG } = require('pngjs');

const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));
const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));

const width = target.width;

// Find the button container by looking for button-colored pixels in the bottom area
// Sample y=1000, x from 200 to 1700
console.log('Target pixels at y=1000:');
for (let x = 200; x < 1700; x += 100) {
  const idx = (1000 * width + x) * 4;
  console.log(`  x=${x}: (${target.data[idx]},${target.data[idx+1]},${target.data[idx+2]})`);
}

console.log('\nDraft pixels at y=1000:');
for (let x = 200; x < 1700; x += 100) {
  const idx = (1000 * width + x) * 4;
  console.log(`  x=${x}: (${draft.data[idx]},${draft.data[idx+1]},${draft.data[idx+2]})`);
}

// Find first row where draft and target differ significantly in bottom area
console.log('\nFirst 10 rows with >50% diff in bottom area (x=200-1700):');
for (let y = 940; y < 1080; y++) {
  let diffCount = 0;
  let total = 0;
  for (let x = 200; x < 1700; x++) {
    const idx = (y * width + x) * 4;
    const d = Math.abs(draft.data[idx] - target.data[idx]) + Math.abs(draft.data[idx+1] - target.data[idx+1]) + Math.abs(draft.data[idx+2] - target.data[idx+2]);
    if (d > 10) diffCount++;
    total++;
  }
  if (diffCount / total > 0.5) {
    console.log(`  y=${y}: ${(diffCount/total*100).toFixed(1)}% diff`);
  }
}
