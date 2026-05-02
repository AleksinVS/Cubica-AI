const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const v = document.querySelector('.game-variable');
    if (!v) return null;
    return {
      outerHTML: v.outerHTML,
      computedColor: getComputedStyle(v).color,
      buttonColor: v.querySelector('button') ? getComputedStyle(v.querySelector('button')).color : null,
      buttonBg: v.querySelector('button') ? getComputedStyle(v.querySelector('button')).backgroundColor : null,
      buttonFontSize: v.querySelector('button') ? getComputedStyle(v.querySelector('button')).fontSize : null,
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
