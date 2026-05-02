const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';
const DRAFT_URL = 'http://localhost:4000?local=true';

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

  const draftInfo = await draftPage.evaluate(() => {
    const el = document.querySelector('.default-main-screen .game-variables-container');
    const s = getComputedStyle(el);
    return {
      backgroundColor: s.backgroundColor,
      backgroundImage: s.backgroundImage,
      backgroundSize: s.backgroundSize,
      backgroundPosition: s.backgroundPosition,
      backgroundRepeat: s.backgroundRepeat,
    };
  });

  const targetInfo = await targetPage.evaluate(() => {
    const el = document.querySelector('.topbar-screen-shell .topbar-variables-container');
    const s = getComputedStyle(el);
    return {
      backgroundColor: s.backgroundColor,
      backgroundImage: s.backgroundImage,
      backgroundSize: s.backgroundSize,
      backgroundPosition: s.backgroundPosition,
      backgroundRepeat: s.backgroundRepeat,
    };
  });

  console.log('DRAFT:', JSON.stringify(draftInfo, null, 2));
  console.log('TARGET:', JSON.stringify(targetInfo, null, 2));
  await browser.close();
}

main().catch(console.error);
