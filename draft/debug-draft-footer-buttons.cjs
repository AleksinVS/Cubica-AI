const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const sel = '.footer';
  const el = await page.$(sel);
  if (!el) { console.log('NOT FOUND'); await browser.close(); return; }
  const children = await el.evaluate(n => Array.from(n.children).map(c => {
    const cs = window.getComputedStyle(c);
    const rect = c.getBoundingClientRect();
    return {
      tag: c.tagName,
      class: c.className,
      text: c.textContent.substring(0, 30),
      width: cs.width,
      height: cs.height,
      display: cs.display,
      backgroundImage: cs.backgroundImage,
      backgroundSize: cs.backgroundSize,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      border: cs.border,
      borderRadius: cs.borderRadius,
      top: rect.top,
      left: rect.left,
    };
  }));
  console.log(JSON.stringify(children, null, 2));

  await browser.close();
})();
