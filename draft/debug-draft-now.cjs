const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const html = await page.content();
  console.log(html.substring(0, 5000));

  await page.screenshot({ path: '/tmp/draft-leftsidebar-debug.png', fullPage: false });
  console.log('Draft screenshot saved');

  await browser.close();
})();
