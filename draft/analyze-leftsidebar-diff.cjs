const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');

const draftPath = './visual-diff-results/draft-leftsidebar.png';
const targetPath = './visual-diff-results/target-leftsidebar.png';

const draftImg = PNG.sync.read(fs.readFileSync(draftPath));
const targetImg = PNG.sync.read(fs.readFileSync(targetPath));
const diffImg = new PNG({ width: draftImg.width, height: draftImg.height });

const diffCount = pixelmatch(draftImg.data, targetImg.data, diffImg.data, draftImg.width, draftImg.height, { threshold: 0.1, includeAA: true });

fs.writeFileSync('./visual-diff-results/diff-leftsidebar-analysis.png', PNG.sync.write(diffImg));

function countDiffInRegion(x, y, w, h) {
  let count = 0;
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const idx = (row * draftImg.width + col) * 4;
      if (diffImg.data[idx] !== 0 || diffImg.data[idx+1] !== 0 || diffImg.data[idx+2] !== 0) {
        count++;
      }
    }
  }
  return count;
}

// Approx regions for 1920x1080
const regions = [
  { name: 'Sidebar (left)', x: 0, y: 0, w: 384, h: 1080 },
  { name: 'Cards area', x: 384, y: 0, w: 1344, h: 972 },
  { name: 'Footer (bottom)', x: 384, y: 972, w: 1344, h: 108 },
  { name: 'Right gutter', x: 1728, y: 0, w: 192, h: 1080 },
];

for (const r of regions) {
  const count = countDiffInRegion(r.x, r.y, r.w, r.h);
  console.log(`${r.name}: ${count} diff pixels (${(count / diffCount * 100).toFixed(1)}%)`);
}

console.log(`Total diff pixels: ${diffCount}`);
