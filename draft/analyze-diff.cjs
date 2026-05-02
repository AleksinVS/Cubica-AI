const fs = require('fs');
const { PNG } = require('pngjs');

const diff = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/diff-topbar.png'));
const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = diff.width;
const height = diff.height;

// Count diffs by region
const regions = {
  'top-left-margin': { x: [0, 192], y: [0, 1080] },
  'top-right-margin': { x: [1728, 1920], y: [0, 1080] },
  'topbar-header': { x: [192, 1728], y: [0, 162] }, // approx 15% of 1080 = 162
  'main-content': { x: [192, 1728], y: [162, 1080] },
};

const counts = {};
for (const r in regions) counts[r] = { diff: 0, total: 0 };

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const dr = diff.data[idx];
    const dg = diff.data[idx+1];
    const db = diff.data[idx+2];
    const isDiff = dr > 0 || dg > 0 || db > 0;
    for (const r in regions) {
      const reg = regions[r];
      if (x >= reg.x[0] && x < reg.x[1] && y >= reg.y[0] && y < reg.y[1]) {
        counts[r].total++;
        if (isDiff) counts[r].diff++;
      }
    }
  }
}

for (const r in counts) {
  const c = counts[r];
  console.log(`${r}: ${c.diff}/${c.total} = ${(c.diff/c.total*100).toFixed(2)}%`);
}

// Also sample specific pixels where diff is high
console.log('\nSample differing pixels in main-content:');
let sampled = 0;
for (let y = 162; y < height; y += 50) {
  for (let x = 192; x < 1728; x += 100) {
    const idx = (y * width + x) * 4;
    const dr = diff.data[idx];
    if (dr > 0) {
      const dIdx = (y * width + x) * 4;
      const tIdx = (y * width + x) * 4;
      console.log(`(${x},${y}) draft=(${draft.data[dIdx]},${draft.data[dIdx+1]},${draft.data[dIdx+2]}) target=(${target.data[tIdx]},${target.data[tIdx+1]},${target.data[tIdx+2]}) diff=${dr}`);
      sampled++;
      if (sampled >= 20) break;
    }
  }
  if (sampled >= 20) break;
}
