const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const el = document.querySelector('.game-variables-container .game-variable:not(.game-variable--score)');
    if (!el) return { error: 'not found' };
    const s = getComputedStyle(el);
    const btn = el.querySelector('button');
    return {
      className: el.className,
      width: s.width,
      height: s.height,
      minWidth: s.minWidth,
      minHeight: s.minHeight,
      display: s.display,
      flexDirection: s.flexDirection,
      justifyContent: s.justifyContent,
      alignItems: s.alignItems,
      gap: s.gap,
      margin: s.margin,
      padding: s.padding,
      borderRadius: s.borderRadius,
      background: s.background,
      backgroundColor: s.backgroundColor,
      border: s.border,
      position: s.position,
      clipPath: s.clipPath,
      boxSizing: s.boxSizing,
      buttonWidth: btn ? getComputedStyle(btn).width : null,
      buttonMinWidth: btn ? getComputedStyle(btn).minWidth : null,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
