const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const footerInfo = await page.evaluate(() => {
    const screen = document.querySelector('.main-screen');
    const footer = screen ? screen.querySelector('.footer, [class*="footer"]') : null;
    const btns = screen ? Array.from(screen.querySelectorAll('button, [role="button"]')) : [];
    return {
      screenClass: screen ? screen.className : null,
      footerClass: footer ? footer.className : null,
      footerRect: footer ? footer.getBoundingClientRect() : null,
      footerHtml: footer ? footer.outerHTML.substring(0, 1000) : null,
      buttons: btns.map(b => ({
        className: b.className,
        id: b.id,
        text: b.textContent.trim().substring(0, 50),
        rect: b.getBoundingClientRect(),
      })),
    };
  });

  console.log(JSON.stringify(footerInfo, null, 2));

  await browser.close();
})();
