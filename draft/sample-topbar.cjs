const fs = require('fs');
const { PNG } = require('pngjs');

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const targetPath = 'draft/visual-diff-results/target-topbar.png';

const draft = PNG.sync.read(fs.readFileSync(draftPath));
const target = PNG.sync.read(fs.readFileSync(targetPath));

const w = draft.width;

function getPixel(img, x, y) {
  const idx = (y * w + x) * 4;
  return [img.data[idx], img.data[idx+1], img.data[idx+2]];
}

console.log('Top bar center pixels (background area between variables):');
const points = [
  { x: 300, y: 20 }, { x: 500, y: 20 }, { x: 700, y: 20 }, { x: 900, y: 20 },
  { x: 1100, y: 20 }, { x: 1300, y: 20 }, { x: 1500, y: 20 },
  { x: 300, y: 80 }, { x: 500, y: 80 }, { x: 700, y: 80 }, { x: 900, y: 80 },
  { x: 1100, y: 80 }, { x: 1300, y: 80 }, { x: 1500, y: 80 },
  { x: 300, y: 140 }, { x: 500, y: 140 }, { x: 700, y: 140 }, { x: 900, y: 140 },
  { x: 1100, y: 140 }, { x: 1300, y: 140 }, { x: 1500, y: 140 },
];

for (const p of points) {
  const d = getPixel(draft, p.x, p.y);
  const t = getPixel(target, p.x, p.y);
  const diff = Math.abs(d[0]-t[0]) + Math.abs(d[1]-t[1]) + Math.abs(d[2]-t[2]);
  console.log(`(${p.x},${p.y}) draft=(${d.join(',')}) target=(${t.join(',')}) diff=${diff}`);
}
