const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const targetPath = 'draft/visual-diff-results/target-topbar.png';

const draft = PNG.sync.read(fs.readFileSync(draftPath));
const target = PNG.sync.read(fs.readFileSync(targetPath));

const w = Math.min(draft.width, target.width);
const h = Math.min(draft.height, target.height);

const diff = new PNG({ width: w, height: h });
diff.data.fill(0);

const totalDiff = pixelmatch(draft.data, target.data, diff.data, w, h, { threshold: 0.1, includeAA: false });

function countDiffRegion(x1, y1, x2, y2) {
  let count = 0;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = (y * w + x) * 4;
      if (diff.data[idx] > 0) count++;
    }
  }
  return count;
}

const regions = [
  { name: 'Top bar', x1: 0, y1: 0, x2: w, y2: 162 },
  { name: 'Main content', x1: 0, y1: 162, x2: w, y2: 960 },
  { name: 'Bottom bar', x1: 0, y1: 960, x2: w, y2: h },
  { name: 'Left margin', x1: 0, y1: 162, x2: 192, y2: 960 },
  { name: 'Right margin', x1: 1728, y1: 162, x2: w, y2: 960 },
  { name: 'Top-left corner', x1: 0, y1: 0, x2: 192, y2: 162 },
  { name: 'Top-right corner', x1: 1728, y1: 0, x2: w, y2: 162 },
];

console.log(`Total diff pixels (pixelmatch): ${totalDiff}`);
for (const r of regions) {
  const d = countDiffRegion(r.x1, r.y1, r.x2, r.y2);
  const total = (r.x2 - r.x1) * (r.y2 - r.y1);
  console.log(`${r.name}: ${d}/${total} = ${(d/total*100).toFixed(2)}%`);
}
