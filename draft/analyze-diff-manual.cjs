const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

function countDiffsInRegion(y0, y1, x0, x1) {
  let diff = 0;
  let total = 0;
  for (let y = y0; y < Math.min(y1, height); y++) {
    for (let x = x0; x < Math.min(x1, width); x++) {
      const idx = (y * width + x) * 4;
      total++;
      const dr = Math.abs(draft.data[idx] - target.data[idx]);
      const dg = Math.abs(draft.data[idx+1] - target.data[idx+1]);
      const db = Math.abs(draft.data[idx+2] - target.data[idx+2]);
      const da = Math.abs(draft.data[idx+3] - target.data[idx+3]);
      if (dr > 25 || dg > 25 || db > 25 || da > 25) {
        diff++;
      }
    }
  }
  return { diff, total };
}

const regions = [
  { name: 'header', y0: 0, y1: 178 },
  { name: 'row1-cards', y0: 178, y1: 574 },
  { name: 'row2-cards', y0: 574, y1: 976 },
  { name: 'bottom', y0: 976, y1: 1080 },
];

for (const r of regions) {
  const { diff, total } = countDiffsInRegion(r.y0, r.y1, 0, width);
  console.log(`${r.name}: ${diff.toLocaleString()} / ${total.toLocaleString()} = ${(diff/total*100).toFixed(2)}%`);
}
