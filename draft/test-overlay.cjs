const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: data.sessionId, playerId: 'player-web', actionId: 'showScreenWithLeftSideBar' })
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Check overlay on buttons at multiple points
  const info = await page.evaluate(() => {
    const btn = document.getElementById('btn-journal');
    if (!btn) return { error: 'btn-journal not found' };
    
    const rect = btn.getBoundingClientRect();
    const points = [
      { x: rect.left + 5, y: rect.top + 5 },
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.right - 5, y: rect.bottom - 5 },
    ];
    
    return points.map((p) => {
      const el = document.elementFromPoint(p.x, p.y);
      return {
        point: p,
        element: el ? { tag: el.tagName, id: el.id, className: el.className } : null,
        isButton: el === btn || btn.contains(el),
      };
    });
  });

  console.log('Overlay check:', JSON.stringify(info, null, 2));

  // Check after opening journal
  await page.click('#btn-journal');
  await page.waitForTimeout(1000);
  
  const journalInfo = await page.evaluate(() => {
    const btn = document.getElementById('btn-journal');
    if (!btn) return { error: 'btn-journal not found in journal' };
    
    const rect = btn.getBoundingClientRect();
    const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      element: el ? { tag: el.tagName, id: el.id, className: el.className } : null,
      isButton: el === btn || btn.contains(el),
      parentChain: [],
    };
  });

  console.log('Journal overlay check:', JSON.stringify(journalInfo, null, 2));

  await browser.close();
})();
