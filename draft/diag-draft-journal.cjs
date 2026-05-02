const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:4000?fixture=screen_j', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const domInfo = await page.evaluate(() => {
    const screen = document.querySelector('.main-screen, .journal-screen');
    if (!screen) return { error: 'No screen found', bodyHTML: document.body.innerHTML.slice(0, 500) };
    
    const addBg = screen.querySelector('.additional-background');
    const containers = Array.from(addBg?.querySelectorAll('.journal-container') || []);
    const entries = Array.from(addBg?.querySelectorAll('.game-card') || []);
    const vars = Array.from(addBg?.querySelectorAll('.journal-variables-container') || []);
    const buttons = Array.from(addBg?.querySelectorAll('.button-container button, .button-helper') || []);
    
    return {
      screenClass: screen.className,
      addBgClass: addBg?.className,
      addBgDisplay: addBg ? window.getComputedStyle(addBg).display : null,
      addBgRect: addBg ? addBg.getBoundingClientRect() : null,
      containerCount: containers.length,
      containers: containers.map(c => ({
        className: c.className,
        rect: c.getBoundingClientRect(),
        display: window.getComputedStyle(c).display,
        float: window.getComputedStyle(c).float,
        width: window.getComputedStyle(c).width,
      })),
      entryCount: entries.length,
      entries: entries.map(e => ({
        text: e.textContent?.trim().slice(0, 60),
        rect: e.getBoundingClientRect(),
      })),
      varContainerCount: vars.length,
      vars: vars.map(v => ({
        childCount: v.children.length,
        rect: v.getBoundingClientRect(),
      })),
      buttonCount: buttons.length,
      buttons: buttons.map(b => ({
        id: b.id,
        text: b.textContent?.trim().slice(0, 30),
        rect: b.getBoundingClientRect(),
      })),
    };
  });

  console.log('Draft DOM info:', JSON.stringify(domInfo, null, 2));

  await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/draft-journal-diag.png', fullPage: false });
  console.log('Screenshot saved to draft/draft-journal-diag.png');

  await browser.close();
})();
