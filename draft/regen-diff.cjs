const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const targetPath = 'draft/visual-diff-results/target-topbar.png';
const diffPath = 'draft/visual-diff-results/diff-topbar.png';

const draft = PNG.sync.read(fs.readFileSync(draftPath));
const target = PNG.sync.read(fs.readFileSync(targetPath));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

const diff = new PNG({ width, height });

const diffPixels = pixelmatch(
  draft.data,
  target.data,
  diff.data,
  width,
  height,
  { threshold: 0.1, includeAA: false }
);

fs.writeFileSync(diffPath, PNG.sync.write(diff));

console.log(`Regenerated diff: ${diffPixels} different pixels (${(diffPixels/(width*height)*100).toFixed(2)}%)`);

// Verify a known identical pixel
const idx = (10 * width + 10) * 4;
console.log(`Diff at (10,10): [${diff.data[idx]},${diff.data[idx+1]},${diff.data[idx+2]},${diff.data[idx+3]}]`);
