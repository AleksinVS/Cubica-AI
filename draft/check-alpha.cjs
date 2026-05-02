const fs = require('fs');
const { PNG } = require('pngjs');

const img = PNG.sync.read(fs.readFileSync('apps/player-web/public/images/arctic-background.png'));

let transparent = 0;
let semiTransparent = 0;
let opaque = 0;
for (let i = 3; i < img.data.length; i += 4) {
  const a = img.data[i];
  if (a < 255) {
    if (a === 0) transparent++;
    else semiTransparent++;
  } else {
    opaque++;
  }
}

console.log(`Total pixels: ${img.width * img.height}`);
console.log(`Transparent: ${transparent}`);
console.log(`Semi-transparent: ${semiTransparent}`);
console.log(`Opaque: ${opaque}`);
