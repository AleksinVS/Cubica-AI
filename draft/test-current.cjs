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

  // Check intro screen (S1 topbar)
  const info = await page.evaluate(() => {
    return {
      buttons: Array.from(document.querySelectorAll('button')).map(b => ({
        id: b.id,
        className: b.className,
        text: b.textContent.trim(),
        disabled: b.disabled,
      })),
      hasAntarcticaPanelButtons: !!document.querySelector('.antarctica-panel-buttons'),
      panelButtonsHTML: document.querySelector('.antarctica-panel-buttons')?.outerHTML?.substring(0, 500),
    };
  });
  console.log('Intro screen:', JSON.stringify(info, null, 2));

  await browser.close();
})();
