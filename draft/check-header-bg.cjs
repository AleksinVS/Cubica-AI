const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = draft.width;

// Sample various points in the header area
const samples = [
  { x: 0, y: 0 },
  { x: 100, y: 80 },
  { x: 500, y: 80 },
  { x: 1000, y: 80 },
  { x: 1800, y: 80 },
  { x: 960, y: 160 },
  { x: 200, y: 150 },
  { x: 1700, y: 10 },
];

for (const s of samples) {
  const idx = (s.y * width + s.x) * 4;
  console.log(`(${s.x},${s.y}) draft=[${draft.data[idx]},${draft.data[idx+1]},${draft.data[idx+2]}] target=[${target.data[idx]},${target.data[idx+1]},${target.data[idx+2]}]`);
}
