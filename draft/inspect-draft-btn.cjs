const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const btn = document.querySelector('.default-main-screen .game-variables-container .game-variable:not(.game-variable--score) button');
    if (!btn) return { error: 'No button found' };
    const s = getComputedStyle(btn);
    return {
      color: s.color,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      textAlign: s.textAlign,
      backgroundColor: s.backgroundColor,
      backgroundImage: s.backgroundImage,
      padding: s.padding,
      width: s.width,
      height: s.height,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error);
