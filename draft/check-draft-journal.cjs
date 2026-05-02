const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const screen = document.querySelector('.journal-container, .journal-screen');
    if (!screen) return { error: 'journal screen not found', bodyClass: document.body.className };
    return {
      className: screen.className,
      rect: screen.getBoundingClientRect(),
      childCount: screen.children.length,
      html: screen.outerHTML.substring(0, 3000),
    };
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
