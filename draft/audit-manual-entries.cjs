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

  // Click journal
  const journalBtn = await page.$('#btn-journal');
  if (journalBtn) {
    await journalBtn.click();
    await page.waitForTimeout(3000);
  }

  const info = await page.evaluate(() => {
    const entries = Array.from(document.querySelectorAll('.journal-entry-card'));
    return {
      entryCount: entries.length,
      entries: entries.map(e => ({
        text: e.textContent?.trim().slice(0, 100),
        rect: e.getBoundingClientRect(),
      })),
      firstContainerHeight: document.querySelector('.journal-container')?.getBoundingClientRect().height,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
