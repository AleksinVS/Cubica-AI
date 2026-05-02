const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });

  const draftPage = await browser.newPage();
  await draftPage.setViewportSize({ width: 1920, height: 1080 });
  await draftPage.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await draftPage.waitForTimeout(2000);

  const targetPage = await browser.newPage();
  await targetPage.setViewportSize({ width: 1920, height: 1080 });
  await targetPage.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await targetPage.$$eval('.cards-container .s1-card, .cards-container .game-card', el => el.length);
    if (cards >= 4) break;
    const btn = await targetPage.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await targetPage.waitForTimeout(3000); } else break;
  }
  await targetPage.waitForTimeout(1000);

  const draftRect = await draftPage.evaluate(() => {
    const el = document.querySelector('.default-main-screen');
    return el.getBoundingClientRect();
  });

  const targetRect = await targetPage.evaluate(() => {
    const el = document.querySelector('.topbar-screen-shell');
    return el.getBoundingClientRect();
  });

  console.log('DRAFT rect:', JSON.stringify(draftRect));
  console.log('TARGET rect:', JSON.stringify(targetRect));

  await browser.close();
}

main().catch(console.error);
