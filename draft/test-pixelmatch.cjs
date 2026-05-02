const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draftPath = 'draft/visual-diff-results/draft-topbar.png';
const draft = PNG.sync.read(fs.readFileSync(draftPath));

const diff = new PNG({ width: draft.width, height: draft.height });

const diffPixels = pixelmatch(
  draft.data,
  draft.data,
  diff.data,
  draft.width,
  draft.height,
  { threshold: 0.1, includeAA: false }
);

console.log(`Identical images diff count: ${diffPixels}`);

const idx = (10 * draft.width + 10) * 4;
console.log(`Diff at (10,10): [${diff.data[idx]},${diff.data[idx+1]},${diff.data[idx+2]},${diff.data[idx+3]}]`);
