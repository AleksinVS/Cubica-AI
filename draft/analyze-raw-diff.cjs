const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');

const draft = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/draft-journal.png'));
const target = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/target-journal.png'));

const diffCount = pixelmatch(draft.data, target.data, null, 1920, 1080, { threshold: 0.1, includeAA: true });
console.log('Total diff pixels:', diffCount);

// Find diff pixels per band
const bands = {};
for (let y = 0; y < 1080; y++) {
  const bandKey = Math.floor(y / 100) * 100;
  for (let x = 0; x < 1920; x++) {
    const idx = (y * 1920 + x) * 4;
    const dr = draft.data[idx], dg = draft.data[idx+1], db = draft.data[idx+2];
    const tr = target.data[idx], tg = target.data[idx+1], tb = target.data[idx+2];
    const delta = Math.abs(dr-tr) + Math.abs(dg-tg) + Math.abs(db-tb);
    if (delta > 77) { // threshold 0.1 in pixelmatch ≈ 25.5 per channel, total ~77
      bands[bandKey] = (bands[bandKey] || 0) + 1;
    }
  }
}

for (const [band, count] of Object.entries(bands).sort((a,b) => Number(a[0])-Number(b[0]))) {
  const pct = ((count / (1920*100)) * 100).toFixed(1);
  console.log(`Y=${band}-${Number(band)+99}: ${count.toLocaleString()} diff pixels (${pct}%)`);
}
