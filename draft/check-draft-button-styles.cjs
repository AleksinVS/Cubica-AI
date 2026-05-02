const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const btns = await page.evaluate(() => {
    const screen = document.querySelector('.main-screen');
    const buttons = screen ? Array.from(screen.querySelectorAll('button')) : [];
    return buttons.map(b => {
      const cs = window.getComputedStyle(b);
      const rect = b.getBoundingClientRect();
      return {
        text: b.textContent.trim().substring(0, 30),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computed: {
          width: cs.width,
          height: cs.height,
          minWidth: cs.minWidth,
          minHeight: cs.minHeight,
          padding: cs.padding,
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          paddingLeft: cs.paddingLeft,
          paddingRight: cs.paddingRight,
          borderWidth: cs.borderWidth,
          boxSizing: cs.boxSizing,
        }
      };
    });
  });

  console.log(JSON.stringify(btns, null, 2));

  await browser.close();
})();
