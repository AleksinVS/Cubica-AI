const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:4000?fixture=screen_j', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const domInfo = await page.evaluate(() => {
    const screen = document.querySelector('.default-main-screen, .main-screen');
    if (!screen) return { error: 'No screen found', bodyHTML: document.body.innerHTML.slice(0, 800) };
    
    // Get all children of additional-background
    const addBg = screen.querySelector('.additional-background, [class*="additional-background"]');
    if (!addBg) return { error: 'No additional-background', screenHTML: screen.innerHTML.slice(0, 800) };
    
    const children = Array.from(addBg.children);
    
    return {
      screenClass: screen.className,
      addBgClass: addBg.className,
      addBgDisplay: window.getComputedStyle(addBg).display,
      addBgGridColumn: window.getComputedStyle(addBg).gridColumn,
      addBgGridRow: window.getComputedStyle(addBg).gridRow,
      addBgRect: addBg.getBoundingClientRect(),
      childCount: children.length,
      children: children.map(c => ({
        tag: c.tagName,
        className: c.className,
        display: window.getComputedStyle(c).display,
        float: window.getComputedStyle(c).float,
        width: window.getComputedStyle(c).width,
        rect: c.getBoundingClientRect(),
        childCount: c.children.length,
      })),
    };
  });

  console.log('Draft DOM info:', JSON.stringify(domInfo, null, 2));

  await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/draft-journal-diag2.png', fullPage: false });
  console.log('Screenshot saved to draft/draft-journal-diag2.png');

  await browser.close();
})();
