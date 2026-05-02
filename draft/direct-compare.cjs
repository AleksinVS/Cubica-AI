const fs = require('fs');
const { PNG } = require('pngjs');

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const targetPath = 'draft/visual-diff-results/target-topbar.png';

const draft = PNG.sync.read(fs.readFileSync(draftPath));
const target = PNG.sync.read(fs.readFileSync(targetPath));

const w = Math.min(draft.width, target.width);
const h = Math.min(draft.height, target.height);

function pixelDiff(x, y) {
  const idx = (y * w + x) * 4;
  return Math.abs(draft.data[idx] - target.data[idx]) +
         Math.abs(draft.data[idx+1] - target.data[idx+1]) +
         Math.abs(draft.data[idx+2] - target.data[idx+2]);
}

// Threshold: diff > 30 (roughly 0.1 * 255 * 3)
const threshold = 30;

const regions = [
  { name: 'Top bar', x1: 0, x2: w, y1: 0, y2: 162 },
  { name: 'Main content', x1: 0, x2: w, y1: 162, y2: 960 },
  { name: 'Bottom bar', x1: 0, x2: w, y1: 960, y2: h },
  { name: 'Left margin', x1: 0, x2: 192, y1: 162, y2: 960 },
  { name: 'Right margin', x1: 1728, x2: w, y1: 162, y2: 960 },
  { name: 'Top-left corner', x1: 0, x2: 192, y1: 0, y2: 162 },
  { name: 'Top-right corner', x1: 1728, x2: w, y1: 0, y2: 162 },
];

for (const r of regions) {
  let diffCount = 0;
  let total = 0;
  for (let y = r.y1; y < r.y2; y++) {
    for (let x = r.x1; x < r.x2; x++) {
      if (pixelDiff(x, y) > threshold) diffCount++;
      total++;
    }
  }
  console.log(`${r.name}: ${diffCount}/${total} = ${(diffCount/total*100).toFixed(2)}%`);
}

// Find some identical background pixels
console.log('\nSample identical pixels (should be background):');
let found = 0;
for (let y = 200; y < 800 && found < 5; y += 50) {
  for (let x = 0; x < 192 && found < 5; x += 10) {
    if (pixelDiff(x, y) <= threshold) {
      const idx = (y * w + x) * 4;
      console.log(`  (${x},${y}): draft=(${draft.data[idx]},${draft.data[idx+1]},${draft.data[idx+2]}) target=(${target.data[idx]},${target.data[idx+1]},${target.data[idx+2]})`);
      found++;
    }
  }
}

// Sample different pixels in right margin
console.log('\nSample different pixels in right margin:');
found = 0;
for (let y = 200; y < 800 && found < 5; y += 50) {
  for (let x = 1728; x < w && found < 5; x += 10) {
    if (pixelDiff(x, y) > threshold) {
      const idx = (y * w + x) * 4;
      console.log(`  (${x},${y}): draft=(${draft.data[idx]},${draft.data[idx+1]},${draft.data[idx+2]}) target=(${target.data[idx]},${target.data[idx+1]},${target.data[idx+2]}) diff=${pixelDiff(x,y)}`);
      found++;
    }
  }
}
