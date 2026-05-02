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
  await page.waitForTimeout(3000);

  // Try to open journal by clicking the journal button if present
  const journalBtn = await page.$('#btn-journal, [data-testid="btn-journal"], button:has-text("журнал"), button:has-text("Журнал")');
  if (journalBtn) {
    await journalBtn.click();
    await page.waitForTimeout(3000);
  }

  const domInfo = await page.evaluate(() => {
    const screen = document.querySelector('.journal-screen');
    if (!screen) return { error: 'No .journal-screen found', bodyClasses: document.body.className };
    
    const containers = Array.from(screen.querySelectorAll('.journal-container'));
    const entries = Array.from(screen.querySelectorAll('.journal-entry-card, .game-card'));
    const vars = Array.from(screen.querySelectorAll('.journal-variables-container'));
    const buttons = Array.from(screen.querySelectorAll('.button-container button, .antarctica-panel-buttons button'));
    
    return {
      screenClass: screen.className,
      containerCount: containers.length,
      containers: containers.map(c => ({
        className: c.className,
        childCount: c.children.length,
        rect: c.getBoundingClientRect(),
      })),
      entryCount: entries.length,
      entries: entries.map(e => ({
        className: e.className,
        text: e.textContent?.trim().slice(0, 60),
        rect: e.getBoundingClientRect(),
      })),
      varContainerCount: vars.length,
      vars: vars.map(v => ({
        childCount: v.children.length,
        rect: v.getBoundingClientRect(),
        firstChildClass: v.children[0]?.className,
      })),
      buttonCount: buttons.length,
      buttons: buttons.map(b => ({
        id: b.id,
        className: b.className,
        text: b.textContent?.trim().slice(0, 30),
      })),
    };
  });

  console.log('Journal DOM info:', JSON.stringify(domInfo, null, 2));

  await page.screenshot({ path: '/home/abc/projects/Cubica-AI/draft/journal-current-diag.png', fullPage: false });
  console.log('Screenshot saved to draft/journal-current-diag.png');

  await browser.close();
})();
