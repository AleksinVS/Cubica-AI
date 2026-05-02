const fs = require('fs');
const { PNG } = require('pngjs');

const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const width = draft.width;

const idx = (500 * width + 50) * 4;
console.log(`Draft at (50,500): r=${draft.data[idx]} g=${draft.data[idx+1]} b=${draft.data[idx+2]} a=${draft.data[idx+3]}`);
console.log(`Target at (50,500): r=${target.data[idx]} g=${target.data[idx+1]} b=${target.data[idx+2]} a=${target.data[idx+3]}`);

const idx2 = (500 * width + 500) * 4;
console.log(`Draft at (500,500): r=${draft.data[idx2]} g=${draft.data[idx2+1]} b=${draft.data[idx2+2]} a=${draft.data[idx2+3]}`);
console.log(`Target at (500,500): r=${target.data[idx2]} g=${target.data[idx2+1]} b=${target.data[idx2+2]} a=${target.data[idx2+3]}`);
