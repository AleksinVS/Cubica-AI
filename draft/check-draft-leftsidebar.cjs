const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const classes = await page.evaluate(() => {
    const screen = document.querySelector('.main-screen');
    return screen ? Array.from(screen.classList) : 'not found';
  });
  console.log('Screen classes:', classes);

  await page.screenshot({ path: '/tmp/draft-leftsidebar-check.png' });
  console.log('Screenshot saved to /tmp/draft-leftsidebar-check.png');

  await browser.close();
})();
