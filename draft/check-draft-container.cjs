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
    const container = document.querySelector('.game-variables-container');
    const s = getComputedStyle(container);
    const screen = document.querySelector('.default-main-screen');
    const screenS = getComputedStyle(screen);
    return {
      containerPadding: s.padding,
      containerGap: s.gap,
      containerJustifyContent: s.justifyContent,
      containerAlignItems: s.alignItems,
      containerBackground: s.background,
      containerHeight: s.height,
      containerWidth: s.width,
      screenBackground: screenS.background,
      screenGridColumns: screenS.gridTemplateColumns,
      screenGridRows: screenS.gridTemplateRows,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
