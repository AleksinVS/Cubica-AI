const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default;

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = draft.width;
const height = draft.height;

const diff = new PNG({ width, height });
diff.data.fill(0);

const diffCount = pixelmatch(draft.data, target.data, diff.data, width, height, { threshold: 0.1, includeAA: true });
console.log('pixelmatch diff count:', diffCount);

// Check a known identical margin pixel at (50, 500)
const idx = (500 * width + 50) * 4;
console.log(`Draft pixel at (50,500): (${draft.data[idx]},${draft.data[idx+1]},${draft.data[idx+2]})`);
console.log(`Target pixel at (50,500): (${target.data[idx]},${target.data[idx+1]},${target.data[idx+2]})`);
console.log(`Diff pixel at (50,500): (${diff.data[idx]},${diff.data[idx+1]},${diff.data[idx+2]})`);

// Check pixel at (500, 500) which should differ
const idx2 = (500 * width + 500) * 4;
console.log(`Draft pixel at (500,500): (${draft.data[idx2]},${draft.data[idx2+1]},${draft.data[idx2+2]})`);
console.log(`Target pixel at (500,500): (${target.data[idx2]},${target.data[idx2+1]},${target.data[idx2+2]})`);
console.log(`Diff pixel at (500,500): (${diff.data[idx2]},${diff.data[idx2+1]},${diff.data[idx2+2]})`);
