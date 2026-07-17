import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import fs from "fs";
import path from "path";
import runtimeCommandClient from "./runtime-command-client.cjs";

const { createBrowserBffSessionClient } = runtimeCommandClient;
const baseUrlTarget = "http://localhost:3003";
const baseUrlDraft = "http://localhost:3000";
const outDir = "/home/abc/projects/Cubica-AI/.tmp/screenshots";

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function writePng(filePath, png) {
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

async function captureDraftJournal(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${baseUrlDraft}?fixture=journal`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const screenshotPath = path.join(outDir, "draft-journal.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log("Draft screenshot saved:", screenshotPath);

  const domInfo = await page.evaluate(() => {
    const entries = document.querySelectorAll(".journal-entry-card, .game-card");
    const container = document.querySelector(".journal-container, .journal-screen");
    return {
      hasJournalContainer: !!document.querySelector(".journal-container"),
      hasJournalScreen: !!document.querySelector(".journal-screen"),
      cardCount: entries.length,
      bodyText: document.body.innerText.substring(0, 200)
    };
  });
  console.log("Draft DOM:", domInfo);

  await page.close();
  return screenshotPath;
}

async function captureTargetJournal(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto(baseUrlTarget, { waitUntil: "networkidle" });
  const runtime = await createBrowserBffSessionClient(page, "antarctica");
  const sessionId = runtime.sessionId;
  console.log("Target session:", sessionId);

  await page.evaluate((sid) => {
    localStorage.setItem("cubica-antarctica-session-id", sid);
  }, sessionId);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const introActions = [
    "opening.info.i0.advance", "opening.info.i02.advance", "opening.info.i03.advance",
    "opening.info.i1.advance", "opening.info.i2.advance", "opening.info.i3.advance",
    "opening.info.i4.advance", "opening.info.i5.advance", "opening.info.i6.advance"
  ];
  for (const actionId of introActions) {
    await runtime.dispatch(actionId);
    await page.waitForTimeout(300);
  }

  for (const cardId of ["1", "2", "3"]) {
    await runtime.dispatch(`opening.card.${cardId}`);
    await page.waitForTimeout(300);
  }

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const journalBtn = await page.locator('button:has-text("Журнал ходов")').first();
  if (await journalBtn.isVisible().catch(() => false)) {
    await journalBtn.click();
    await page.waitForTimeout(2000);
  }

  const screenshotPath = path.join(outDir, "target-journal.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log("Target screenshot saved:", screenshotPath);

  const domInfo = await page.evaluate(() => {
    const entries = document.querySelectorAll(".journal-entry-card");
    return {
      entryCount: entries.length,
      hasJournalScreen: !!document.querySelector(".journal-screen"),
      hasJournalContainer: !!document.querySelector(".journal-container")
    };
  });
  console.log("Target DOM:", domInfo);

  await page.close();
  return screenshotPath;
}

function compareScreenshots(draftPath, targetPath) {
  const draftImg = readPng(draftPath);
  const targetImg = readPng(targetPath);

  if (draftImg.width !== targetImg.width || draftImg.height !== targetImg.height) {
    console.log("Dimensions differ. Draft:", draftImg.width, "x", draftImg.height, "Target:", targetImg.width, "x", targetImg.height);
    // Resize to match (use target as reference)
    // For simplicity, just compare overlapping region
    const minWidth = Math.min(draftImg.width, targetImg.width);
    const minHeight = Math.min(draftImg.height, targetImg.height);
    const diff = new PNG({ width: minWidth, height: minHeight });
    const diffPixels = pixelmatch(
      draftImg.data, targetImg.data, diff.data,
      minWidth, minHeight,
      { threshold: 0.1, includeAA: true }
    );
    const totalPixels = minWidth * minHeight;
    const diffPercent = (diffPixels / totalPixels) * 100;
    console.log(`Diff pixels: ${diffPixels} / ${totalPixels} = ${diffPercent.toFixed(2)}%`);
    return { diffPixels, totalPixels, diffPercent, diff };
  }

  const { width, height } = draftImg;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    draftImg.data, targetImg.data, diff.data,
    width, height,
    { threshold: 0.1, includeAA: true }
  );
  const totalPixels = width * height;
  const diffPercent = (diffPixels / totalPixels) * 100;
  console.log(`Diff pixels: ${diffPixels} / ${totalPixels} = ${diffPercent.toFixed(2)}%`);
  return { diffPixels, totalPixels, diffPercent, diff };
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  console.log("=== Capturing Draft Journal ===");
  const draftPath = await captureDraftJournal(browser);

  console.log("\n=== Capturing Target Journal ===");
  const targetPath = await captureTargetJournal(browser);

  console.log("\n=== Comparing Screenshots ===");
  const result = compareScreenshots(draftPath, targetPath);

  const diffPath = path.join(outDir, "journal-diff.png");
  writePng(diffPath, result.diff);
  console.log("Diff image saved:", diffPath);

  console.log(`\n=== RESULT ===`);
  console.log(`Diff percentage: ${result.diffPercent.toFixed(2)}%`);
  console.log(`Target: < 5%`);
  console.log(`Status: ${result.diffPercent < 5 ? "PASS" : "FAIL"}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
