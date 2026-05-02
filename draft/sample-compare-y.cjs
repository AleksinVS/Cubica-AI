const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));
const w = draft.width;

function getPixel(img, x, y) {
  const idx = (y * w + x) * 4;
  return [img.data[idx], img.data[idx+1], img.data[idx+2]];
}

const x = 900;
const ys = [20, 80, 140, 200, 300, 500, 700, 900];

for (const y of ys) {
  const d = getPixel(draft, x, y);
  const t = getPixel(target, x, y);
  const diff = Math.abs(d[0]-t[0]) + Math.abs(d[1]-t[1]) + Math.abs(d[2]-t[2]);
  console.log(`(${x},${y}) draft=(${d.join(',')}) target=(${t.join(',')}) diff=${diff}`);
}
