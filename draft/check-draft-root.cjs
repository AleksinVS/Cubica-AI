const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const html = document.querySelector('html');
    const body = document.querySelector('body');
    return {
      htmlFontSize: getComputedStyle(html).fontSize,
      bodyFontSize: getComputedStyle(body).fontSize,
      bodyColor: getComputedStyle(body).color,
      bodyFontFamily: getComputedStyle(body).fontFamily,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error);
