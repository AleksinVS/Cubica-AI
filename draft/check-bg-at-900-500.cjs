const { PNG } = require('pngjs');
const fs = require('fs');
const bg = PNG.sync.read(fs.readFileSync('apps/player-web/public/images/arctic-background.png'));
const draft = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/draft-topbar.png'));
const target = PNG.sync.read(fs.readFileSync('draft/visual-diff-results/target-topbar.png'));

const x = 900, y = 500;
const idx = (y * bg.width + x) * 4;
console.log(`BG (${x},${y}): (${bg.data[idx]},${bg.data[idx+1]},${bg.data[idx+2]})`);
console.log(`Draft (${x},${y}): (${draft.data[idx]},${draft.data[idx+1]},${draft.data[idx+2]})`);
console.log(`Target (${x},${y}): (${target.data[idx]},${target.data[idx+1]},${target.data[idx+2]})`);
