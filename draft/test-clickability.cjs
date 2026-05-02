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

  const info = await page.evaluate(() => {
    const btn = document.getElementById('btn-journal');
    if (!btn) return { error: 'btn-journal not found' };
    
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    const cs = window.getComputedStyle(btn);
    
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      center: { cx, cy },
      topElement: topEl ? { tag: topEl.tagName, id: topEl.id, className: topEl.className } : null,
      isTopElement: topEl === btn || btn.contains(topEl),
      pointerEvents: cs.pointerEvents,
      opacity: cs.opacity,
      display: cs.display,
      visibility: cs.visibility,
      zIndex: cs.zIndex,
    };
  });
  console.log('Button check:', JSON.stringify(info, null, 2));

  // Try click
  console.log('\nTrying click...');
  try {
    await page.click('#btn-journal');
    console.log('Click succeeded');
  } catch (e) {
    console.log('Click failed:', e.message);
  }
  await page.waitForTimeout(2000);
  
  const journalVisible = await page.evaluate(() => !!document.querySelector('.journal-screen'));
  console.log('Journal visible:', journalVisible);

  await browser.close();
})();
