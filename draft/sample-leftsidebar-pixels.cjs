const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/draft-leftsidebar.png'));
const target = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/target-leftsidebar.png'));

const coords = [
  [500, 500], [700, 500], [900, 500],
  [500, 700], [700, 700], [900, 700],
  [500, 900], [700, 900], [900, 900],
  [200, 500], [200, 700], [200, 900],
];

for (const [x, y] of coords) {
  const idx = (y * 1920 + x) * 4;
  const dr = draft.data[idx], dg = draft.data[idx+1], db = draft.data[idx+2];
  const tr = target.data[idx], tg = target.data[idx+1], tb = target.data[idx+2];
  const delta = Math.abs(dr-tr) + Math.abs(dg-tg) + Math.abs(db-tb);
  const mark = delta > 30 ? '***' : '   ';
  console.log(`${mark} (${x},${y}) DRAFT: rgb(${dr},${dg},${db})  TARGET: rgb(${tr},${tg},${tb})  delta=${delta}`);
}
