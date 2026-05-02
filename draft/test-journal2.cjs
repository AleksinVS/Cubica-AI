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

  // Click 'Продолжить' to advance from intro
  const continueBtn = await page.$('button.action-button');
  if (continueBtn) {
    console.log('Clicking continue...');
    await continueBtn.click();
    await page.waitForTimeout(3000);
  }

  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => ({
      id: b.id,
      className: b.className,
      text: b.textContent.trim()
    }));
  });
  console.log('Buttons after continue:', JSON.stringify(buttons, null, 2));

  await browser.close();
})();
