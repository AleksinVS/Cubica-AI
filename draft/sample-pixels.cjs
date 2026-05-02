const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/draft-journal.png'));
const target = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/target-journal.png'));

const coords = [
  [400, 120], [600, 120], [800, 120],
  [400, 180], [600, 180], [800, 180],
  [400, 250], [600, 250], [800, 250],
  [400, 350], [600, 350], [800, 350],
  [400, 450], [600, 450], [800, 450],
  [500, 550], [700, 550], [900, 550],
  [500, 650], [700, 650], [900, 650],
  [500, 800], [700, 800], [900, 800],
  [500, 950], [700, 950], [900, 950],
];

for (const [x, y] of coords) {
  const idx = (y * 1920 + x) * 4;
  const dr = draft.data[idx], dg = draft.data[idx+1], db = draft.data[idx+2];
  const tr = target.data[idx], tg = target.data[idx+1], tb = target.data[idx+2];
  const delta = Math.abs(dr-tr) + Math.abs(dg-tg) + Math.abs(db-tb);
  const mark = delta > 30 ? '***' : '   ';
  console.log(`${mark} (${x},${y}) DRAFT: rgb(${dr},${dg},${db})  TARGET: rgb(${tr},${tg},${tb})  delta=${delta}`);
}
