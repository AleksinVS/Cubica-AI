const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return { error: 'sidebar not found' };
    const metrics = Array.from(sidebar.children).slice(0, 3);
    return metrics.map((m, i) => {
      const cs = window.getComputedStyle(m);
      return {
        index: i,
        className: m.className,
        text: m.textContent.trim().substring(0, 50),
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        color: cs.color,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        textAlign: cs.textAlign,
        rect: m.getBoundingClientRect(),
      };
    });
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
