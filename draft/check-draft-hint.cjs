const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const main = document.querySelector('.main-screen');
    return {
      mainClass: main ? main.className : null,
      mainChildren: main ? Array.from(main.children).map(c => ({
        tag: c.tagName,
        className: c.className,
        id: c.id,
        text: c.textContent.trim().substring(0, 100),
      })) : null,
    };
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
