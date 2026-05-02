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

  // Check what's at the button positions
  const info = await page.evaluate(() => {
    const btnJournal = document.getElementById('btn-journal');
    const btnHint = document.getElementById('btn-hint');

    if (!btnJournal) return { error: 'btn-journal not found' };

    const rect = btnJournal.getBoundingClientRect();
    const points = [
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, name: 'center' },
      { x: rect.left + 2, y: rect.top + 2, name: 'top-left' },
      { x: rect.right - 2, y: rect.bottom - 2, name: 'bottom-right' },
    ];

    const results = points.map(p => {
      const el = document.elementFromPoint(p.x, p.y);
      return {
        point: p,
        element: el ? {
          tag: el.tagName,
          id: el.id,
          className: el.className,
          zIndex: window.getComputedStyle(el).zIndex,
          position: window.getComputedStyle(el).position,
          pointerEvents: window.getComputedStyle(el).pointerEvents,
        } : null,
        isBtnJournal: el === btnJournal || (el && btnJournal.contains(el)),
      };
    });

    // Check for additional-background
    const addBg = document.querySelector('.additional-background');
    const addBgRect = addBg ? addBg.getBoundingClientRect() : null;

    return {
      screenClass: document.querySelector('.s1-screen')?.className,
      btnRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      points: results,
      addBg: addBg ? {
        className: addBg.className,
        rect: { x: addBgRect.x, y: addBgRect.y, width: addBgRect.width, height: addBgRect.height },
        zIndex: window.getComputedStyle(addBg).zIndex,
        pointerEvents: window.getComputedStyle(addBg).pointerEvents,
        overlapsJournal: addBgRect &&
          addBgRect.left < rect.right && addBgRect.right > rect.left &&
          addBgRect.top < rect.bottom && addBgRect.bottom > rect.top,
      } : null,
    };
  });

  console.log('Overlay diagnostic:', JSON.stringify(info, null, 2));

  // Highlight both elements
  await page.evaluate(() => {
    const addBg = document.querySelector('.additional-background');
    if (addBg) {
      addBg.style.outline = '8px solid blue';
      addBg.style.opacity = '0.7';
    }
    document.querySelectorAll('#btn-journal, #btn-hint').forEach((b) => {
      b.style.outline = '8px solid red';
    });
  });
  await page.screenshot({ path: '/tmp/overlay-debug.png' });
  console.log('Screenshot saved to /tmp/overlay-debug.png');

  await browser.close();
})();
