const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  const computed = await page.evaluate(() => {
    const btnContainer = document.querySelector('.button-container');
    const addBg = document.querySelector('.additional-background');
    return {
      buttonContainer: btnContainer ? {
        zIndex: window.getComputedStyle(btnContainer).zIndex,
        className: btnContainer.className,
      } : null,
      additionalBackground: addBg ? {
        pointerEvents: window.getComputedStyle(addBg).pointerEvents,
        zIndex: window.getComputedStyle(addBg).zIndex,
      } : null,
    };
  });

  console.log('Computed styles:', JSON.stringify(computed, null, 2));
  await browser.close();
})();
