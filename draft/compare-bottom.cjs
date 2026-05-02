const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function inspectBottom(page, label) {
  const containers = await page.evaluate(() => {
    const el = document.querySelector('.button-container');
    if (!el) return null;
    return {
      class: el.className,
      rect: el.getBoundingClientRect(),
      bg: getComputedStyle(el).backgroundColor,
      padding: getComputedStyle(el).padding,
      display: getComputedStyle(el).display,
      gap: getComputedStyle(el).gap,
    };
  });
  console.log(`\n=== ${label} button container ===`);
  console.log(JSON.stringify(containers, null, 2));

  const buttons = await page.evaluate(() => {
    const els = document.querySelectorAll('.button-container button');
    return Array.from(els).map(b => ({
      text: b.textContent.slice(0, 15),
      rect: b.getBoundingClientRect(),
      bg: getComputedStyle(b).backgroundColor,
    }));
  });
  console.log(`${label} buttons:`);
  buttons.forEach((b, i) => console.log(`  ${i}: text="${b.text}" rect=(${b.rect.x},${b.rect.y},${b.rect.width},${b.rect.height})`));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await inspectBottom(page, 'DRAFT');

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container > *');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);
  await inspectBottom(page, 'TARGET');

  await browser.close();
}

main().catch(console.error);
