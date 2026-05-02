const fs = require('fs');
const { PNG } = require('pngjs');

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const targetPath = 'draft/visual-diff-results/target-topbar.png';
const diffPath = 'draft/visual-diff-results/diff-topbar.png';

const draft = PNG.sync.read(fs.readFileSync(draftPath));
const target = PNG.sync.read(fs.readFileSync(targetPath));
const diff = PNG.sync.read(fs.readFileSync(diffPath));

function getPixel(img, x, y) {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx], img.data[idx+1], img.data[idx+2], img.data[idx+3]];
}

const coords = [
  { x: 10, y: 10 },
  { x: 100, y: 100 },
  { x: 500, y: 50 },
  { x: 1800, y: 50 },
];

for (const p of coords) {
  const d = getPixel(draft, p.x, p.y);
  const t = getPixel(target, p.x, p.y);
  const df = getPixel(diff, p.x, p.y);
  console.log(`(${p.x},${p.y}) draft=[${d.join(',')}] target=[${t.join(',')}] diff=[${df.join(',')}]`);
}
