const fs = require('fs');
const { PNG } = require('pngjs');

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const targetPath = 'draft/visual-diff-results/target-topbar.png';

const draft = PNG.sync.read(fs.readFileSync(draftPath));
const target = PNG.sync.read(fs.readFileSync(targetPath));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

// Compare a few pixels from the top-left corner (background area, no UI)
const samplePoints = [
  { x: 10, y: 10 },
  { x: 100, y: 100 },
  { x: 500, y: 50 },
  { x: 1000, y: 50 },
  { x: 1800, y: 50 },
  { x: 50, y: 500 },
  { x: 500, y: 500 },
  { x: 1000, y: 500 },
];

for (const p of samplePoints) {
  const idx = (p.y * width + p.x) * 4;
  const dr = draft.data[idx];
  const dg = draft.data[idx+1];
  const db = draft.data[idx+2];
  const da = draft.data[idx+3];
  const tr = target.data[idx];
  const tg = target.data[idx+1];
  const tb = target.data[idx+2];
  const ta = target.data[idx+3];
  const diff = Math.abs(dr - tr) + Math.abs(dg - tg) + Math.abs(db - tb);
  console.log(`(${p.x},${p.y}) draft=(${dr},${dg},${db},${da}) target=(${tr},${tg},${tb},${ta}) diff=${diff}`);
}

// Count how many pixels are EXACTLY identical
let identical = 0;
let total = 0;
for (let y = 0; y < height; y += 10) {
  for (let x = 0; x < width; x += 10) {
    const idx = (y * width + x) * 4;
    if (draft.data[idx] === target.data[idx] &&
        draft.data[idx+1] === target.data[idx+1] &&
        draft.data[idx+2] === target.data[idx+2] &&
        draft.data[idx+3] === target.data[idx+3]) {
      identical++;
    }
    total++;
  }
}
console.log(`\nSampled ${total} pixels (every 10th), identical: ${identical} (${(identical/total*100).toFixed(2)}%)`);
