const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const { sessionId } = await res.json();
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showScreenWithLeftSideBar' })
  });

  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const path = await page.evaluate(() => {
    const el = document.querySelector('.leftsidebar-screen');
    if (!el) return { error: 'not found' };
    const parents = [];
    let curr = el;
    while (curr && curr !== document.body) {
      const cs = window.getComputedStyle(curr);
      parents.unshift({
        tag: curr.tagName,
        className: curr.className,
        rect: curr.getBoundingClientRect(),
        margin: cs.margin,
        padding: cs.padding,
        border: cs.borderWidth,
        position: cs.position,
        top: cs.top,
        left: cs.left,
      });
      curr = curr.parentElement;
    }
    return parents;
  });

  console.log(JSON.stringify(path, null, 2));

  await browser.close();
})();
