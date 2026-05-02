const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const footer = document.querySelector('.footer');
    if (!footer) return { error: 'footer not found' };
    const cs = window.getComputedStyle(footer);
    return {
      width: cs.width,
      height: cs.height,
      padding: cs.padding,
      paddingLeft: cs.paddingLeft,
      paddingRight: cs.paddingRight,
      gap: cs.gap,
      gridTemplateColumns: cs.gridTemplateColumns,
      gridTemplateRows: cs.gridTemplateRows,
      fontSize: cs.fontSize,
      boxSizing: cs.boxSizing,
    };
  });

  console.log('Draft footer:', JSON.stringify(info, null, 2));

  await browser.close();
})();
