const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));
const w = draft.width;

function getPixel(img, x, y) {
  const idx = (y * w + x) * 4;
  return [img.data[idx], img.data[idx+1], img.data[idx+2]];
}

const points = [
  { x: 50, y: 20 }, { x: 50, y: 80 }, { x: 50, y: 140 },
  { x: 50, y: 200 }, { x: 50, y: 500 }, { x: 50, y: 900 },
  { x: 1850, y: 20 }, { x: 1850, y: 80 }, { x: 1850, y: 140 },
  { x: 1850, y: 200 }, { x: 1850, y: 500 }, { x: 1850, y: 900 },
];

for (const p of points) {
  const d = getPixel(draft, p.x, p.y);
  const t = getPixel(target, p.x, p.y);
  const diff = Math.abs(d[0]-t[0]) + Math.abs(d[1]-t[1]) + Math.abs(d[2]-t[2]);
  console.log(`(${p.x},${p.y}) draft=(${d.join(',')}) target=(${t.join(',')}) diff=${diff}`);
}
