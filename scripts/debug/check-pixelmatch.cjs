const { chromium } = require("playwright");
const fs = require("fs");
const PNG = require("pngjs").PNG;
const pixelmatch = require("pixelmatch").default || require("pixelmatch");
const { createBrowserBffSessionClient } = require("./runtime-command-client.cjs");

const draftUrl = "http://localhost:3000/?fixture=journal";
const targetUrl = "http://localhost:3003";

async function createSession(page) {
  const runtime = await createBrowserBffSessionClient(page, "antarctica");

  const infoAdvances = [
    "opening.info.i0.advance", "opening.info.i02.advance", "opening.info.i03.advance",
    "opening.info.i1.advance", "opening.info.i2.advance", "opening.info.i3.advance",
    "opening.info.i4.advance", "opening.info.i5.advance", "opening.info.i6.advance"
  ];
  for (const actionId of infoAdvances) {
    await runtime.dispatch(actionId);
  }

  for (const actionId of ["opening.card.1", "opening.card.2"]) {
    await runtime.dispatch(actionId);
  }
  return runtime.sessionId;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const draftPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await draftPage.goto(draftUrl, { waitUntil: "networkidle" });
  await draftPage.waitForTimeout(3000);
  const draftPath = "/home/abc/projects/Cubica-AI/.tmp/screenshots/draft-journal.png";
  await draftPage.screenshot({ path: draftPath });

  const targetPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await targetPage.goto(targetUrl, { waitUntil: "networkidle" });
  const sessionId = await createSession(targetPage);
  await targetPage.evaluate((sid) => { localStorage.setItem('cubica-antarctica-session-id', sid); }, sessionId);
  await targetPage.reload({ waitUntil: "networkidle" });
  await targetPage.waitForTimeout(3000);
  const journalBtn = await targetPage.$('text=журнал ходов');
  if (journalBtn) await journalBtn.click();
  await targetPage.waitForTimeout(2000);
  const targetPath = "/home/abc/projects/Cubica-AI/.tmp/screenshots/target-journal.png";
  await targetPage.screenshot({ path: targetPath });

  await browser.close();

  const draftImg = PNG.sync.read(fs.readFileSync(draftPath));
  const targetImg = PNG.sync.read(fs.readFileSync(targetPath));
  const { width, height } = draftImg;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(draftImg.data, targetImg.data, diff.data, width, height, { threshold: 0.1 });
  const totalPixels = width * height;
  const diffPercent = ((diffPixels / totalPixels) * 100).toFixed(2);
  const diffPath = "/home/abc/projects/Cubica-AI/.tmp/screenshots/diff-journal.png";
  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  console.log(`Draft: ${width}x${height}, Target: ${targetImg.width}x${targetImg.height}`);
  console.log(`Diff pixels: ${diffPixels} / ${totalPixels} (${diffPercent}%)`);
})();
