const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';
const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });

  // Draft
  const draftPage = await browser.newPage();
  await draftPage.setViewportSize({ width: 1920, height: 1080 });
  await draftPage.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await draftPage.waitForTimeout(1000);
  const draftCards = await draftPage.evaluate(() => {
    return Array.from(document.querySelectorAll('.cards-container .game-card')).map((c, i) => ({
      index: i,
      text: c.textContent.trim(),
    }));
  });
  console.log('=== DRAFT cards ===');
  console.log(JSON.stringify(draftCards, null, 2));
  await draftPage.close();

  // Target - fresh context
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
  const targetCards = await targetPage.evaluate(() => {
    const container = document.querySelector('.topbar-screen-shell .cards-container, .topbar-screen-shell .topbar-cards-container');
    const cards = container ? container.querySelectorAll('.s1-card, article') : [];
    return Array.from(cards).map((c, i) => ({
      index: i,
      text: c.querySelector('.s1-card-text')?.textContent.trim() ?? c.textContent.trim(),
      className: c.className,
    }));
  });
  console.log('\n=== TARGET cards ===');
  console.log(JSON.stringify(targetCards, null, 2));

  await browser.close();
}

main().catch(console.error);
