const fs = require('fs');
const { PNG } = require('pngjs');

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const targetPath = 'draft/visual-diff-results/target-topbar.png';

const draft = PNG.sync.read(fs.readFileSync(draftPath));
const target = PNG.sync.read(fs.readFileSync(targetPath));

const w = Math.min(draft.width, target.width);
const h = Math.min(draft.height, target.height);

function regionDiff(x1, y1, x2, y2) {
  let diff = 0;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = (y * w + x) * 4;
      const d = Math.abs(draft.data[idx] - target.data[idx]) +
                Math.abs(draft.data[idx+1] - target.data[idx+1]) +
                Math.abs(draft.data[idx+2] - target.data[idx+2]);
      if (d > 30) diff++;
    }
  }
  return diff;
}

// Check the first variable area in draft and target
// Draft first variable is at x≈36, y≈42.5, width≈75, height≈130 (from earlier inspection)
// But we need to find where the variables are in the target

console.log('Diff in top bar horizontal slices:');
for (let x = 0; x < w; x += 200) {
  const d = regionDiff(x, 0, Math.min(x+200, w), 162);
  console.log(`  x=${x}-${x+200}: ${d} pixels`);
}

console.log('\nDiff in top bar vertical slices (center x=800-1120):');
for (let y = 0; y < 162; y += 20) {
  const d = regionDiff(800, y, 1120, Math.min(y+20, 162));
  console.log(`  y=${y}-${y+20}: ${d} pixels`);
}
