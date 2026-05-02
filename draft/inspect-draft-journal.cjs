const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:4000?local=true&screen=journal', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const addBg = document.querySelector('.additional-background');
    if (!addBg) return { error: 'No additional-background' };
    
    const children = Array.from(addBg.children);
    const containers = children.filter(c => c.classList.contains('journal-container'));
    const btns = children.filter(c => c.classList.contains('button-container'));
    
    return {
      addBgDisplay: window.getComputedStyle(addBg).display,
      addBgClass: addBg.className,
      childCount: children.length,
      children: children.map(c => ({
        tag: c.tagName,
        className: c.className,
        display: window.getComputedStyle(c).display,
        float: window.getComputedStyle(c).float,
        width: window.getComputedStyle(c).width,
        rect: c.getBoundingClientRect(),
      })),
      containerRects: containers.map(c => c.getBoundingClientRect()),
      buttonRect: btns[0]?.getBoundingClientRect(),
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
