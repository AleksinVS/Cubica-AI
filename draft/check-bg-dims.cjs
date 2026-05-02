const { PNG } = require('pngjs');
const fs = require('fs');
const bg = PNG.sync.read(fs.readFileSync('apps/player-web/public/images/arctic-background.png'));
console.log(`Background image: ${bg.width}x${bg.height}`);
