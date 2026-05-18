const { chromium } = require("playwright");
const PNG = require("pngjs").PNG;
const pixelmatch = require("pixelmatch").default;
const fs = require("fs");

const runtimeUrl = "http://localhost:3001";
const draftUrl = "http://localhost:3000/?fixture=journal";
const targetUrl = "http://localhost:3003";

async function createSession() {
  const createRes = await fetch(`${runtimeUrl}/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: "antarctica", playerId: "test-player" })
  });
  const session = await createRes.json();

  for (const actionId of [
    "opening.info.i0.advance", "opening.info.i02.advance", "opening.info.i03.advance",
    "opening.info.i1.advance", "opening.info.i2.advance", "opening.info.i3.advance",
    "opening.info.i4.advance", "opening.info.i5.advance", "opening.info.i6.advance"
  ]) {
    await fetch(`${runtimeUrl}/actions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, playerId: "test-player", actionId, payload: {} })
    });
  }

  for (const actionId of ["opening.card.1", "opening.card.2"]) {
    await fetch(`${runtimeUrl}/actions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, playerId: "test-player", actionId, payload: {} })
    });
  }
  return session.sessionId;
}

(async () => {
  const sessionId = await createSession();

  const browser = await chromium.launch({ headless: true });

  // Draft screenshot
  const draftPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await draftPage.goto(draftUrl, { waitUntil: "networkidle" });
  await draftPage.waitForTimeout(3000);
  const draftPath = "/home/abc/projects/Cubica-AI/.tmp/screenshots/draft-final.png";
  await draftPage.screenshot({ path: draftPath });

  // Target screenshot
  const targetPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await targetPage.goto(targetUrl);
  await targetPage.evaluate((sid) => { localStorage.setItem('cubica-antarctica-session-id', sid); }, sessionId);
  await targetPage.reload({ waitUntil: "networkidle" });
  await targetPage.waitForTimeout(3000);
  const journalBtn = await targetPage.$('text=журнал ходов');
  if (journalBtn) await journalBtn.click();
  await targetPage.waitForTimeout(2000);
  const targetPath = "/home/abc/projects/Cubica-AI/.tmp/screenshots/target-final.png";
  await targetPage.screenshot({ path: targetPath });

  await browser.close();

  // Pixelmatch
  const draftImg = PNG.sync.read(fs.readFileSync(draftPath));
  const targetImg = PNG.sync.read(fs.readFileSync(targetPath));

  const width = Math.max(draftImg.width, targetImg.width);
  const height = Math.max(draftImg.height, targetImg.height);

  const draftCanvas = new PNG({ width, height });
  const targetCanvas = new PNG({ width, height });
  const diffCanvas = new PNG({ width, height });

  for (let y = 0; y < draftImg.height; y++) {
    for (let x = 0; x < draftImg.width; x++) {
      const idx = (y * draftImg.width + x) * 4;
      const cIdx = (y * width + x) * 4;
      draftCanvas.data[cIdx] = draftImg.data[idx];
      draftCanvas.data[cIdx+1] = draftImg.data[idx+1];
      draftCanvas.data[cIdx+2] = draftImg.data[idx+2];
      draftCanvas.data[cIdx+3] = draftImg.data[idx+3];
    }
  }
  for (let y = 0; y < targetImg.height; y++) {
    for (let x = 0; x < targetImg.width; x++) {
      const idx = (y * targetImg.width + x) * 4;
      const cIdx = (y * width + x) * 4;
      targetCanvas.data[cIdx] = targetImg.data[idx];
      targetCanvas.data[cIdx+1] = targetImg.data[idx+1];
      targetCanvas.data[cIdx+2] = targetImg.data[idx+2];
      targetCanvas.data[cIdx+3] = targetImg.data[idx+3];
    }
  }

  const diffPixels = pixelmatch(draftCanvas.data, targetCanvas.data, diffCanvas.data, width, height, { threshold: 0.1, includeAA: false });
  const totalPixels = width * height;
  const diffPercent = ((diffPixels / totalPixels) * 100).toFixed(2);

  const diffPath = "/home/abc/projects/Cubica-AI/.tmp/screenshots/final-diff.png";
  fs.writeFileSync(diffPath, PNG.sync.write(diffCanvas));

  console.log(`Draft: ${draftImg.width}x${draftImg.height}`);
  console.log(`Target: ${targetImg.width}x${targetImg.height}`);
  console.log(`Diff pixels: ${diffPixels} / ${totalPixels} (${diffPercent}%)`);
  console.log(`Diff image: ${diffPath}`);
})();
