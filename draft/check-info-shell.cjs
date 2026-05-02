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
    const infoShell = document.querySelector('.info-screen-shell');
    const topbarShell = document.querySelector('.topbar-screen-shell');
    const firstVar = document.querySelector('.topbar-variables-container .game-variable:not(.game-variable--score)');
    return {
      infoShellExists: !!infoShell,
      infoShellParent: infoShell?.parentElement?.className,
      infoShellDisplay: infoShell ? getComputedStyle(infoShell).display : null,
      topbarShellExists: !!topbarShell,
      topbarShellParent: topbarShell?.parentElement?.className,
      firstVarGrandparent: firstVar?.parentElement?.parentElement?.className,
      firstVarParent: firstVar?.parentElement?.className,
      allTopbarVarsContainers: Array.from(document.querySelectorAll('.topbar-variables-container')).map((el, i) => ({
        index: i,
        parentClass: el.parentElement?.className,
        grandparentClass: el.parentElement?.parentElement?.className,
        varCount: el.querySelectorAll('.game-variable').length,
        display: getComputedStyle(el).display,
      })),
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
