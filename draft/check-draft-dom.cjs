const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?fixture=screen_leftsidebar', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Check what classes exist
  const html = await page.content();
  console.log('Has leftsidebar-screen:', html.includes('leftsidebar-screen'));
  console.log('Has main-screen:', html.includes('main-screen'));
  console.log('Has sidebar:', html.includes('sidebar'));
  console.log('Has game-variables-container:', html.includes('game-variables-container'));
  console.log('Has cards-container:', html.includes('cards-container'));

  // Capture screenshot
  await page.screenshot({ path: 'draft/visual-diff-results/draft-check.png', fullPage: false });
  console.log('Screenshot saved');

  // Sample DOM structure
  const body = await page.$eval('body', el => el.innerHTML.substring(0, 2000));
  console.log(body);

  await browser.close();
})();
