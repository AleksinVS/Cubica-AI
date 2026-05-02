const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const vars = document.querySelectorAll('.default-main-screen .game-variables-container .game-variable:not(.game-variable--score)');
    if (!vars.length) return { error: 'No vars found' };
    const el = vars[0];
    const s = getComputedStyle(el);
    const btn = el.querySelector('button');
    const btnS = btn ? getComputedStyle(btn) : null;
    return {
      className: el.className,
      tagName: el.tagName,
      width: s.width,
      height: s.height,
      display: s.display,
      justifyContent: s.justifyContent,
      alignItems: s.alignItems,
      gap: s.gap,
      margin: s.margin,
      padding: s.padding,
      borderRadius: s.borderRadius,
      textAlign: s.textAlign,
      fontFamily: s.fontFamily,
      buttonWidth: btnS?.width,
      buttonMinWidth: btnS?.minWidth,
      buttonPadding: btnS?.padding,
      buttonFontSize: btnS?.fontSize,
      buttonColor: btnS?.color,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error);
