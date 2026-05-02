const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const el = document.querySelector('.default-main-screen .game-variables-container .game-variable:not(.game-variable--score)');
    if (!el) return { error: 'No var found' };
    const caption = el.querySelector('div > span');
    const s = caption ? getComputedStyle(caption) : null;
    return {
      captionFontSize: s?.fontSize,
      captionColor: s?.color,
      captionFontWeight: s?.fontWeight,
      captionFontFamily: s?.fontFamily,
      captionTextTransform: s?.textTransform,
      captionLineHeight: s?.lineHeight,
      captionTextAlign: s?.textAlign,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error);
