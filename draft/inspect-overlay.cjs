const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function inspectOverlay(page, label) {
  const el = await page.evaluate(() => {
    const x = 900, y = 500;
    const elements = document.elementsFromPoint(x, y);
    return elements.slice(0, 8).map(e => ({
      tag: e.tagName,
      class: e.className,
      id: e.id,
      bgColor: getComputedStyle(e).backgroundColor,
      bgImage: getComputedStyle(e).backgroundImage.slice(0, 60),
      opacity: getComputedStyle(e).opacity,
    }));
  });
  console.log(`\n=== ${label} elementsFromPoint(900,500) ===`);
  el.forEach((e, i) => console.log(`  ${i}: <${e.tag}> class="${e.class}" id="${e.id}" bg=${e.bgColor} opacity=${e.opacity}`));
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  const draftPage = await browser.newPage();
  await draftPage.setViewportSize({ width: 1920, height: 1080 });
  await draftPage.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await draftPage.waitForTimeout(2000);
  await inspectOverlay(draftPage, 'DRAFT');

  const targetPage = await browser.newPage();
  await targetPage.setViewportSize({ width: 1920, height: 1080 });
  await targetPage.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await targetPage.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await targetPage.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await targetPage.waitForTimeout(3000); } else break;
  }
  await targetPage.waitForTimeout(1000);
  await inspectOverlay(targetPage, 'TARGET');

  await browser.close();
}

main().catch(console.error);
