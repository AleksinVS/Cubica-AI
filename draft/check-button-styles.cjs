const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Draft
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const draftBtns = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.button-container button')).map(b => {
      const r = b.getBoundingClientRect();
      const s = getComputedStyle(b);
      return {
        text: b.textContent.trim(),
        width: r.width,
        height: r.height,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
        paddingLeft: s.paddingLeft,
        paddingRight: s.paddingRight,
        marginTop: s.marginTop,
        marginBottom: s.marginBottom,
        display: s.display,
        boxSizing: s.boxSizing,
      };
    });
  });
  console.log('=== DRAFT buttons ===');
  console.log(JSON.stringify(draftBtns, null, 2));

  // Target
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);
  const targetBtns = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.topbar-screen-shell .button-container button')).map(b => {
      const r = b.getBoundingClientRect();
      const s = getComputedStyle(b);
      return {
        text: b.textContent.trim(),
        width: r.width,
        height: r.height,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
        paddingLeft: s.paddingLeft,
        paddingRight: s.paddingRight,
        marginTop: s.marginTop,
        marginBottom: s.marginBottom,
        display: s.display,
        boxSizing: s.boxSizing,
      };
    });
  });
  console.log('\n=== TARGET buttons ===');
  console.log(JSON.stringify(targetBtns, null, 2));

  await browser.close();
}

main().catch(console.error);
