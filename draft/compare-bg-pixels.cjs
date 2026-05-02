const fs = require('fs');
const { PNG } = require('pngjs');

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const targetPath = 'draft/visual-diff-results/target-topbar.png';

const draft = PNG.sync.read(fs.readFileSync(draftPath));
const target = PNG.sync.read(fs.readFileSync(targetPath));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

// Sample pixels in the far right margin (should be pure background, no UI)
// and bottom area (should be pure background below cards)
const samplePoints = [];
for (let y = 200; y < 800; y += 100) {
  for (let x = 1700; x < 1900; x += 50) {
    samplePoints.push({ x, y });
  }
}

let identical = 0;
let total = 0;
for (const p of samplePoints) {
  const idx = (p.y * width + p.x) * 4;
  const dr = draft.data[idx];
  const dg = draft.data[idx+1];
  const db = draft.data[idx+2];
  const tr = target.data[idx];
  const tg = target.data[idx+1];
  const tb = target.data[idx+2];
  const diff = Math.abs(dr - tr) + Math.abs(dg - tg) + Math.abs(db - tb);
  if (diff === 0) identical++;
  total++;
  if (diff > 0) {
    console.log(`(${p.x},${p.y}) draft=(${dr},${dg},${db}) target=(${tr},${tg},${tb}) diff=${diff}`);
  }
}

console.log(`Identical: ${identical}/${total} (${(identical/total*100).toFixed(2)}%)`);
