const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$eval('.cards-container .s1-card, .cards-container .game-card', el => el.length);
    if (cards >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const shell = document.querySelector('.topbar-screen-shell');
    if (!shell) return { error: 'No topbar-screen-shell' };
    const container = shell.querySelector('.topbar-variables-container');
    if (!container) return { error: 'No topbar-variables-container in shell' };
    const scoreVar = container.querySelector('.game-variable--score');
    const nonScoreVar = container.querySelector('.game-variable:not(.game-variable--score)');
    const cs = getComputedStyle(container);
    const ss = scoreVar ? getComputedStyle(scoreVar) : null;
    const ns = nonScoreVar ? getComputedStyle(nonScoreVar) : null;
    return {
      container: {
        display: cs.display,
        alignItems: cs.alignItems,
        justifyContent: cs.justifyContent,
        gap: cs.gap,
        height: cs.height,
        padding: cs.padding,
      },
      scoreVar: scoreVar ? {
        width: ss.width,
        height: ss.height,
        display: ss.display,
        gap: ss.gap,
        textAlign: ss.textAlign,
      } : null,
      nonScoreVar: nonScoreVar ? {
        width: ns.width,
        height: ns.height,
        display: ns.display,
        gap: ns.gap,
        textAlign: ns.textAlign,
      } : null,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error);
