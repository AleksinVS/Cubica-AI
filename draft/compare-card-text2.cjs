const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function inspectCards(page, label) {
  const cards = await page.evaluate(() => {
    const all = document.querySelectorAll('.cards-container > *');
    return Array.from(all).slice(0, 6).map((c, i) => ({
      index: i,
      text: c.textContent,
      class: c.className,
    }));
  });
  console.log(`\n=== ${label} cards ===`);
  cards.forEach(c => console.log(`  ${c.index}: class="${c.class}" text="${c.text}"`));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Same flow as visual-diff.js
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await inspectCards(page, 'DRAFT');

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container > *');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);
  await inspectCards(page, 'TARGET');

  await browser.close();
}

main().catch(console.error);
