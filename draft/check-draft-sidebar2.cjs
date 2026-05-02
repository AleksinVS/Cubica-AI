const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const sidebarInfo = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return { error: 'sidebar not found' };
    const children = Array.from(sidebar.children).map(c => ({
      tag: c.tagName,
      className: c.className,
      text: c.textContent.trim().substring(0, 100),
      rect: c.getBoundingClientRect(),
    }));
    return { children };
  });

  console.log('Draft sidebar children:', JSON.stringify(sidebarInfo, null, 2));

  await browser.close();
})();
