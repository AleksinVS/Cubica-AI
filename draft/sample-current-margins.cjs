const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

// Sample left margin
let identical = 0;
let total = 0;
for (let y = 0; y < height; y += 20) {
  for (let x = 0; x < 192; x += 20) {
    const idx = (y * width + x) * 4;
    const d = [draft.data[idx], draft.data[idx+1], draft.data[idx+2]];
    const t = [target.data[idx], target.data[idx+1], target.data[idx+2]];
    const diff = Math.abs(d[0]-t[0]) + Math.abs(d[1]-t[1]) + Math.abs(d[2]-t[2]);
    if (diff === 0) identical++;
    total++;
  }
}
console.log(`Left margin identical: ${identical}/${total} (${(identical/total*100).toFixed(2)}%)`);

// Sample right margin
identical = 0;
total = 0;
for (let y = 0; y < height; y += 20) {
  for (let x = 1728; x < 1920; x += 20) {
    const idx = (y * width + x) * 4;
    const d = [draft.data[idx], draft.data[idx+1], draft.data[idx+2]];
    const t = [target.data[idx], target.data[idx+1], target.data[idx+2]];
    const diff = Math.abs(d[0]-t[0]) + Math.abs(d[1]-t[1]) + Math.abs(d[2]-t[2]);
    if (diff === 0) identical++;
    total++;
  }
}
console.log(`Right margin identical: ${identical}/${total} (${(identical/total*100).toFixed(2)}%)`);

// Check some main content area points
const points = [
  {x: 400, y: 300},
  {x: 600, y: 400},
  {x: 900, y: 500},
  {x: 1200, y: 600},
];
for (const p of points) {
  const idx = (p.y * width + p.x) * 4;
  const d = [draft.data[idx], draft.data[idx+1], draft.data[idx+2]];
  const t = [target.data[idx], target.data[idx+1], target.data[idx+2]];
  const diff = Math.abs(d[0]-t[0]) + Math.abs(d[1]-t[1]) + Math.abs(d[2]-t[2]);
  console.log(`(${p.x},${p.y}) draft=(${d}) target=(${t}) diff=${diff}`);
}
