const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  // Advance past intro to reach S1 board screen
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

  const info = await page.evaluate(() => {
    const btnJournal = document.getElementById('btn-journal');
    const btnHint = document.getElementById('btn-hint');

    const results = {};

    // Check all buttons
    for (const id of ['btn-journal', 'btn-hint', 'nav-left', 'nav-right']) {
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
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        centerElement: topEl ? { tag: topEl.tagName, id: topEl.id, className: topEl.className } : null,
        isClickable: topEl === btn || (topEl && btn.contains(topEl)),
      };
    }

    // Check additional-background elements
    const addBgs = Array.from(document.querySelectorAll('.additional-background'));
    results.additionalBackgrounds = addBgs.map((el, i) => {
      const style = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        index: i,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        zIndex: style.zIndex,
        pointerEvents: style.pointerEvents,
        gridColumn: style.gridColumn,
        gridRow: style.gridRow,
      };
    });

    // Check main-content-area
    const mca = document.querySelector('.main-content-area');
    if (mca) {
      const style = window.getComputedStyle(mca);
      const r = mca.getBoundingClientRect();
      results.mainContentArea = {
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        zIndex: style.zIndex,
        position: style.position,
      };
    }

    // Check screen class
    results.screenClass = document.querySelector('.s1-screen')?.className;

    return results;
  });

  console.log('Overlay diagnostic:', JSON.stringify(info, null, 2));

  // Highlight
  await page.evaluate(() => {
    document.querySelectorAll('.additional-background').forEach((el, i) => {
      el.style.outline = '8px solid blue';
      el.style.opacity = '0.7';
      el.style.zIndex = '9999';
    });
    document.querySelectorAll('#btn-journal, #btn-hint, #nav-left, #nav-right').forEach((b) => {
      b.style.outline = '8px solid red';
      b.style.zIndex = '99999';
    });
  });
  await page.screenshot({ path: '/tmp/overlay-debug2.png' });
  console.log('Screenshot saved to /tmp/overlay-debug2.png');

  await browser.close();
})();
