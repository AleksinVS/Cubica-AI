const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = Math.min(draft.width, target.width);
const height = Math.min(draft.height, target.height);

const diff = new PNG({ width, height });
diff.data.fill(0);

const count = pixelmatch(draft.data, target.data, diff.data, width, height, { threshold: 0.1, includeAA: true });
console.log(`Diff pixels: ${count} / ${width * height} = ${(count / (width * height) * 100).toFixed(2)}%`);
