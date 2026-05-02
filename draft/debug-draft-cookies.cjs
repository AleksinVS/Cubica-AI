const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const cookies = await browser.contexts()[0].cookies();
  console.log('Cookies:', JSON.stringify(cookies, null, 2));

  await browser.close();
})();
