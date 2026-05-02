const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });

  const draftPage = await browser.newPage();
  await draftPage.setViewportSize({ width: 1920, height: 1080 });
  await draftPage.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  const draftDpr = await draftPage.evaluate(() => window.devicePixelRatio);

  const targetPage = await browser.newPage();
  await targetPage.setViewportSize({ width: 1920, height: 1080 });
  await targetPage.goto(TARGET_URL, { waitUntil: 'networkidle' });
  const targetDpr = await targetPage.evaluate(() => window.devicePixelRatio);

  console.log(`Draft DPR: ${draftDpr}`);
  console.log(`Target DPR: ${targetDpr}`);

  await browser.close();
}

main().catch(console.error);
