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

  const info = await page.evaluate(() => {
    const descs = document.querySelectorAll('.leftsidebar-screen .game-variable-description');
    return Array.from(descs).slice(0, 3).map((d, i) => {
      const cs = window.getComputedStyle(d);
      const rect = d.getBoundingClientRect();
      return {
        index: i,
        text: d.textContent.trim().substring(0, 100),
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        height: cs.height,
        margin: cs.margin,
        padding: cs.padding,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      };
    });
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
