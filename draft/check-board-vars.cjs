const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const shell = document.querySelector('.topbar-screen-shell');
    if (!shell) return { error: 'no topbar-screen-shell' };
    const vars = Array.from(shell.querySelectorAll('.topbar-variables-container .game-variable')).map(el => {
      const s = getComputedStyle(el);
      return {
        className: el.className,
        width: s.width,
        height: s.height,
        display: s.display,
        border: s.border,
        borderRadius: s.borderRadius,
        background: s.background,
      };
    });
    return { shellClass: shell.className, varCount: vars.length, vars };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
