const fs = require('fs');
const { PNG } = require('pngjs');

const draftPath = './visual-diff-results/draft-leftsidebar.png';
const targetPath = './visual-diff-results/target-leftsidebar.png';

const draftImg = PNG.sync.read(fs.readFileSync(draftPath));
const targetImg = PNG.sync.read(fs.readFileSync(targetPath));

function countDiffInRegion(x, y, w, h) {
  let count = 0;
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const idx = (row * draftImg.width + col) * 4;
      if (draftImg.data[idx] !== targetImg.data[idx] ||
          draftImg.data[idx+1] !== targetImg.data[idx+1] ||
          draftImg.data[idx+2] !== targetImg.data[idx+2] ||
          draftImg.data[idx+3] !== targetImg.data[idx+3]) {
        count++;
      }
    }
  }
  return count;
}

const totalDiff = countDiffInRegion(0, 0, draftImg.width, draftImg.height);

const regions = [
  { name: 'Sidebar (left)', x: 0, y: 0, w: 384, h: 1080 },
  { name: 'Cards area', x: 384, y: 0, w: 1344, h: 972 },
  { name: 'Footer (bottom)', x: 384, y: 972, w: 1344, h: 108 },
  { name: 'Right gutter', x: 1728, y: 0, w: 192, h: 1080 },
];

for (const r of regions) {
  const count = countDiffInRegion(r.x, r.y, r.w, r.h);
  console.log(`${r.name}: ${count} diff pixels (${(count / totalDiff * 100).toFixed(1)}%)`);
}

console.log(`Total diff pixels: ${totalDiff}`);
