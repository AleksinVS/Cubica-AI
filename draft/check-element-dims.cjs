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
    const cards = await targetPage.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await targetPage.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await targetPage.waitForTimeout(3000); } else break;
  }
  await targetPage.waitForTimeout(1000);

  const draftDims = await draftPage.evaluate(() => {
    const el = document.querySelector('.default-main-screen');
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height, top: rect.top, left: rect.left };
  });

  const targetDims = await targetPage.evaluate(() => {
    const el = document.querySelector('.topbar-screen-shell');
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height, top: rect.top, left: rect.left };
  });

  console.log('DRAFT dims:', JSON.stringify(draftDims));
  console.log('TARGET dims:', JSON.stringify(targetDims));

  // Check for overlays / filters
  const draftOverlay = await draftPage.evaluate(() => {
    const el = document.querySelector('.default-main-screen');
    const s = getComputedStyle(el);
    return { opacity: s.opacity, filter: s.filter, mixBlendMode: s.mixBlendMode };
  });

  const targetOverlay = await targetPage.evaluate(() => {
    const el = document.querySelector('.topbar-screen-shell');
    const s = getComputedStyle(el);
    return { opacity: s.opacity, filter: s.filter, mixBlendMode: s.mixBlendMode };
  });

  console.log('DRAFT overlay:', JSON.stringify(draftOverlay));
  console.log('TARGET overlay:', JSON.stringify(targetOverlay));

  await browser.close();
}

main().catch(console.error);
