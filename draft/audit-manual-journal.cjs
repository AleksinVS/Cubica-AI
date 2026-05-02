const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  const sessionId = data.sessionId;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Click through intro
  for (let i = 0; i < 15; i++) {
    const isBoard = await page.evaluate(() => !!document.querySelector('.topbar-screen-shell'));
    if (isBoard) break;
    const btn = await page.$('button:has-text("Продолжить"), button:has-text("Далее")');
    if (btn) { await btn.click(); await page.waitForTimeout(2000); }
    else break;
  }

  // Click journal button
  const journalBtn = await page.$('#btn-journal');
  if (journalBtn) {
    await journalBtn.click();
    await page.waitForTimeout(3000);
  }

  // Full DOM audit
  const audit = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return { error: 'No main' };

    const children = Array.from(main.children);
    return {
      mainChildCount: children.length,
      children: children.map(c => ({
        tag: c.tagName,
        className: c.className,
        rect: c.getBoundingClientRect(),
        innerHTML: c.innerHTML.slice(0, 200),
      })),
      journalScreen: !!document.querySelector('.journal-screen'),
      fallbackScreen: !!document.querySelector('.topbar-screen-shell, .info-screen-shell'),
      journalMainContent: document.querySelector('.journal-main-content')?.getBoundingClientRect(),
      journalContainers: Array.from(document.querySelectorAll('.journal-container')).map(c => c.getBoundingClientRect()),
      fallbackContainers: Array.from(document.querySelectorAll('.topbar-screen-shell .cards-container, .info-screen-shell .info-event-card')).map(c => c.getBoundingClientRect()),
    };
  });

  console.log('DOM AUDIT:', JSON.stringify(audit, null, 2));
  await browser.close();
})();
