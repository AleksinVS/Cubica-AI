const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

// Focus on bottom area: y=976 to y=1080
const y0 = 976;
const y1 = 1080;

let diffCount = 0;
let total = 0;
let sampleDiffs = [];

for (let y = y0; y < y1; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    total++;
    const dr = Math.abs(draft.data[idx] - target.data[idx]);
    const dg = Math.abs(draft.data[idx+1] - target.data[idx+1]);
    const db = Math.abs(draft.data[idx+2] - target.data[idx+2]);
    const da = Math.abs(draft.data[idx+3] - target.data[idx+3]);
    if (dr > 25 || dg > 25 || db > 25 || da > 25) {
      diffCount++;
      if (sampleDiffs.length < 10) {
        sampleDiffs.push({ x, y, draft: [draft.data[idx], draft.data[idx+1], draft.data[idx+2]], target: [target.data[idx], target.data[idx+1], target.data[idx+2]] });
      }
    }
  }
}

console.log(`Bottom area: ${diffCount}/${total} = ${(diffCount/total*100).toFixed(2)}%`);
console.log('Sample diffs:', JSON.stringify(sampleDiffs, null, 2));
