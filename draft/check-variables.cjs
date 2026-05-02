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
  await page.waitForSelector('.default-main-screen', { timeout: 15000 });
  await page.waitForTimeout(1000);

  const draftVars = await page.evaluate(() => {
    const container = document.querySelector('.game-variables-container');
    const vars = container ? container.querySelectorAll('.game-variable, button') : [];
    return {
      containerRect: container?.getBoundingClientRect(),
      items: Array.from(vars).map(v => {
        const r = v.getBoundingClientRect();
        const s = getComputedStyle(v);
        return {
          tag: v.tagName,
          className: v.className,
          text: v.textContent.trim().substring(0, 30),
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
          color: s.color,
        };
      }),
    };
  });
  console.log('=== DRAFT variables ===');
  console.log(JSON.stringify(draftVars, null, 2));

  // Target
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.s1-screen, .antarctica-fallback-renderer, .leftsidebar-screen', { timeout: 15000 });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const targetVars = await page.evaluate(() => {
    const container = document.querySelector('.topbar-screen-shell .game-variables-container');
    const vars = container ? container.querySelectorAll('.game-variable, .game-variable-image, .game-variable-caption, .game-variable-value') : [];
    return {
      containerRect: container?.getBoundingClientRect(),
      items: Array.from(vars).map(v => {
        const r = v.getBoundingClientRect();
        const s = getComputedStyle(v);
        return {
          tag: v.tagName,
          className: v.className,
          text: v.textContent.trim().substring(0, 30),
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
          color: s.color,
        };
      }),
    };
  });
  console.log('\n=== TARGET variables ===');
  console.log(JSON.stringify(targetVars, null, 2));

  await browser.close();
}

main().catch(console.error);
