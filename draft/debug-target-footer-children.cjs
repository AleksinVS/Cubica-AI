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

  const sel = '.leftsidebar-screen .bottom-controls-container';
  const el = await page.$(sel);
  if (!el) { console.log('NOT FOUND'); await browser.close(); return; }
  const html = await el.evaluate(n => n.innerHTML);
  console.log(html.substring(0, 1200));

  // Get direct children classes
  const children = await el.evaluate(n => Array.from(n.children).map(c => ({ tag: c.tagName, class: c.className, text: c.textContent.substring(0, 30) })));
  console.log('Children:', JSON.stringify(children, null, 2));

  await browser.close();
})();
