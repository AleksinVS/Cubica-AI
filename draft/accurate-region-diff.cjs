const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = draft.width;
const height = draft.height;

function compareRegion(name, x1, x2, y1, y2) {
  let identical = 0;
  let total = 0;
  let sumDiff = 0;
  for (let y = y1; y < Math.min(y2, height); y++) {
    for (let x = x1; x < Math.min(x2, width); x++) {
      const idx = (y * width + x) * 4;
      const dr = draft.data[idx] - target.data[idx];
      const dg = draft.data[idx+1] - target.data[idx+1];
      const db = draft.data[idx+2] - target.data[idx+2];
      const diff = Math.abs(dr) + Math.abs(dg) + Math.abs(db);
      if (diff === 0) identical++;
      sumDiff += diff;
      total++;
    }
  }
  console.log(`${name}: identical=${identical}/${total} (${(identical/total*100).toFixed(1)}%) avgDiff=${(sumDiff/total).toFixed(1)}`);
}

compareRegion('left-margin', 0, 192, 0, 1080);
compareRegion('right-margin', 1728, 1920, 0, 1080);
compareRegion('header', 192, 1728, 0, 178);
compareRegion('card1', 382, 760, 178, 564);
compareRegion('card2', 770, 1150, 178, 564);
compareRegion('card3', 1159, 1537, 178, 564);
compareRegion('card4', 382, 760, 564, 944);
compareRegion('card5', 770, 1150, 564, 944);
compareRegion('card6', 1159, 1537, 564, 944);
compareRegion('bottom-area', 192, 1728, 944, 1080);
