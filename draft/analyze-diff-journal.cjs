const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');

const draft = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/draft-journal.png'));
const target = PNG.sync.read(fs.readFileSync('/home/abc/projects/Cubica-AI/draft/visual-diff-results/target-journal.png'));
const diff = new PNG({ width: 1920, height: 1080 });

pixelmatch(draft.data, target.data, diff.data, 1920, 1080, { threshold: 0.1, includeAA: true });

const bands = {};
for (let y = 0; y < 1080; y++) {
  let bandDiff = 0;
  for (let x = 0; x < 1920; x++) {
    const idx = (y * 1920 + x) * 4;
    if (diff.data[idx] > 0 || diff.data[idx+1] > 0 || diff.data[idx+2] > 0) {
      bandDiff++;
    }
  }
  const bandKey = Math.floor(y / 100) * 100;
  bands[bandKey] = (bands[bandKey] || 0) + bandDiff;
}

for (const [band, count] of Object.entries(bands).sort((a,b) => Number(a[0])-Number(b[0]))) {
  const pct = ((count / (1920*100)) * 100).toFixed(1);
  console.log(`Y=${band}-${Number(band)+99}: ${count.toLocaleString()} diff pixels (${pct}%)`);
}
