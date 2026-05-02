const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  const sessionId = data.sessionId;
  console.log('Session:', sessionId);

  // Dispatch showHistory action
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showHistory' })
  });
  console.log('Dispatched showHistory');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const domInfo = await page.evaluate(() => {
    const screen = document.querySelector('.journal-screen');
    if (!screen) {
      // Try to find what screen IS visible
      const allScreens = Array.from(document.querySelectorAll('[class*="screen"]'));
      return {
        error: 'No .journal-screen found',
        screens: allScreens.map(s => s.className),
        bodyHTML: document.body.innerHTML.slice(0, 500),
      };
    }
    
    const containers = Array.from(screen.querySelectorAll('.journal-container'));
    const entries = Array.from(screen.querySelectorAll('.journal-entry-card, .game-card'));
    const vars = Array.from(screen.querySelectorAll('.journal-variables-container'));
    const buttons = Array.from(screen.querySelectorAll('.button-container button, .antarctica-panel-buttons button'));
    const metrics = Array.from(screen.querySelectorAll('.game-variable'));
    
    return {
      screenClass: screen.className,
      screenRect: screen.getBoundingClientRect(),
      containerCount: containers.length,
      containers: containers.map(c => ({
        className: c.className,
        childCount: c.children.length,
        rect: c.getBoundingClientRect(),
        bg: window.getComputedStyle(c).backgroundColor,
      })),
      entryCount: entries.length,
      entries: entries.map(e => ({
        className: e.className,
        text: e.textContent?.trim().slice(0, 80),
        rect: e.getBoundingClientRect(),
        bg: window.getComputedStyle(e).backgroundColor,
      })),
      varContainerCount: vars.length,
      vars: vars.map(v => ({
        childCount: v.children.length,
        rect: v.getBoundingClientRect(),
        firstChildClass: v.children[0]?.className,
        firstChildHTML: v.children[0]?.innerHTML?.slice(0, 200),
      })),
      buttonCount: buttons.length,
      buttons: buttons.map(b => ({
        id: b.id,
        className: b.className,
        text: b.textContent?.trim().slice(0, 30),
        rect: b.getBoundingClientRect(),
      })),
      metricCount: metrics.length,
      metrics: metrics.map(m => ({
        className: m.className,
        text: m.textContent?.trim().slice(0, 40),
        rect: m.getBoundingClientRect(),
      })),
    };
  });

  console.log('Journal DOM info:', JSON.stringify(domInfo, null, 2));

  await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/journal-open-diag.png', fullPage: false });
  console.log('Screenshot saved to draft/journal-open-diag.png');

  await browser.close();
})();
