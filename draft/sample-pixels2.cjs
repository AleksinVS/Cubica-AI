const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/draft-journal.png'));
const target = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/target-journal.png'));

const coords = [
  [300, 130], [500, 130], [700, 130], [900, 130],
  [300, 170], [500, 170], [700, 170], [900, 170],
  [300, 220], [500, 220], [700, 220], [900, 220],
  [300, 280], [500, 280], [700, 280], [900, 280],
  [300, 350], [500, 350], [700, 350], [900, 350],
  [300, 420], [500, 420], [700, 420], [900, 420],
  [500, 500], [700, 500], [900, 500],
];

for (const [x, y] of coords) {
  const idx = (y * 1920 + x) * 4;
  const dr = draft.data[idx], dg = draft.data[idx+1], db = draft.data[idx+2];
  const tr = target.data[idx], tg = target.data[idx+1], tb = target.data[idx+2];
  const delta = Math.abs(dr-tr) + Math.abs(dg-tg) + Math.abs(db-tb);
  const mark = delta > 30 ? '***' : '   ';
  console.log(`${mark} (${x},${y}) DRAFT: rgb(${dr},${dg},${db})  TARGET: rgb(${tr},${tg},${tb})  delta=${delta}`);
}
