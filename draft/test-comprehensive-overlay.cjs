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

  const results = await page.evaluate(() => {
    const screen = document.querySelector('.s1-screen');
    const addBg = document.querySelector('.additional-background');
    const mca = document.querySelector('.main-content-area');
    const btnContinue = document.querySelector('.info-bottom-controls button, .bottom-controls-container button');

    const r = {
      screenClass: screen?.className,
      addBg: addBg ? {
        rect: addBg.getBoundingClientRect(),
        pointerEvents: window.getComputedStyle(addBg).pointerEvents,
        zIndex: window.getComputedStyle(addBg).zIndex,
      } : null,
      mainContentArea: mca ? {
        rect: mca.getBoundingClientRect(),
        zIndex: window.getComputedStyle(mca).zIndex,
        position: window.getComputedStyle(mca).position,
      } : null,
      continueButton: btnContinue ? {
        rect: btnContinue.getBoundingClientRect(),
        id: btnContinue.id,
        className: btnContinue.className,
      } : null,
    };

    // Check if continue button is clickable via elementFromPoint
    if (btnContinue) {
      const rect = btnContinue.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      r.continueButton.isClickable = topEl === btnContinue || (topEl && btnContinue.contains(topEl));
      r.continueButton.topElement = topEl ? { tag: topEl.tagName, id: topEl.id, className: topEl.className } : null;
    }

    // Check all buttons on page
    const allButtons = Array.from(document.querySelectorAll('button'));
    r.allButtons = allButtons.map(b => ({
      id: b.id,
      className: b.className,
      text: b.textContent?.trim().slice(0, 30),
      rect: b.getBoundingClientRect(),
    }));

    return r;
  });

  console.log('Comprehensive overlay check:', JSON.stringify(results, null, 2));

  await browser.close();
})();
