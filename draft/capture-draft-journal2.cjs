const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:4000?local=true&screen=journal', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/draft-journal-current.png', fullPage: false });
  console.log('Screenshot saved');
  await browser.close();
})();
