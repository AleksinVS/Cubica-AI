const fs = require('fs');
const { PNG } = require('pngjs');

const bg = PNG.sync.read(fs.readFileSync('apps/player-web/public/images/arctic-background.png'));
const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

// The background image is 1920x1080
function getPixel(img, x, y) {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx], img.data[idx+1], img.data[idx+2]];
}

const coords = [
  { x: 50, y: 20 },
  { x: 50, y: 80 },
  { x: 50, y: 500 },
  { x: 900, y: 20 },
  { x: 900, y: 500 },
  { x: 1850, y: 20 },
];

for (const p of coords) {
  const bgp = getPixel(bg, p.x, p.y);
  const dp = getPixel(draft, p.x, p.y);
  const tp = getPixel(target, p.x, p.y);
  console.log(`(${p.x},${p.y}) bg=(${bgp.join(',')}) draft=(${dp.join(',')}) target=(${tp.join(',')})`);
}
