const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const title = await page.title();
  const hasScreen = await page.evaluate(() => !!document.querySelector('.main-screen, .journal-container, .leftsidebar-screen'));
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log('Title:', title);
  console.log('Has screen class:', hasScreen);
  console.log('Body text:', bodyText);

  await browser.close();
})();
