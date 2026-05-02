const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const sel = '.cards-container > .game-card:first-child';
  const html = await page.$eval(sel, el => el.outerHTML);
  console.log(html.substring(0, 800));

  // Check if there is a button
  const btn = await page.$('.cards-container > .game-card:first-child button, .cards-container > .game-card:first-child .action-button');
  if (btn) {
    const disp = await btn.evaluate(b => window.getComputedStyle(b).display);
    const rect = await btn.evaluate(b => b.getBoundingClientRect());
    console.log('button display:', disp, 'rect:', JSON.stringify(rect));
  } else {
    console.log('button NOT FOUND');
  }

  await browser.close();
})();
