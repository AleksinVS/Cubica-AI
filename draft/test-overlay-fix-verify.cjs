const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  // Advance past intro
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: data.sessionId, playerId: 'player-web', actionId: 'advanceIntro' })
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  // Check current screen
  let screenClass = await page.evaluate(() => document.querySelector('.s1-screen')?.className);
  console.log('Initial screen:', screenClass);

  // If on info screen, click continue to reach board
  const continueBtn = await page.$('.info-bottom-controls button, .bottom-controls-container button');
  if (continueBtn) {
    console.log('Clicking continue to reach board...');
    await continueBtn.click();
    await page.waitForTimeout(3000);
    screenClass = await page.evaluate(() => document.querySelector('.s1-screen')?.className);
    console.log('Screen after continue:', screenClass);
  }

  // Check button clickability with elementFromPoint
  const clickability = await page.evaluate(() => {
    const results = {};
    for (const id of ['btn-journal', 'btn-hint']) {
      const btn = document.getElementById(id);
      if (!btn) {
        results[id] = { found: false };
        continue;
      }
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      results[id] = {
        found: true,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        topElement: topEl ? { tag: topEl.tagName, id: topEl.id, className: topEl.className } : null,
        isClickable: topEl === btn || (topEl && btn.contains(topEl)),
      };
    }
    return results;
  });

  console.log('Clickability:', JSON.stringify(clickability, null, 2));

  // Highlight for screenshot
  await page.evaluate(() => {
    document.querySelectorAll('.additional-background').forEach((el) => {
      el.style.outline = '6px solid blue';
      el.style.opacity = '0.6';
    });
    document.querySelectorAll('#btn-journal, #btn-hint').forEach((b) => {
      b.style.outline = '6px solid red';
    });
  });
  await page.screenshot({ path: '/tmp/overlay-fix-verify.png' });
  console.log('Screenshot saved to /tmp/overlay-fix-verify.png');

  await browser.close();
})();
