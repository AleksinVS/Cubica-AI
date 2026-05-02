const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Target
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const { sessionId } = await res.json();
  await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showHint' })
  });

  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const targetText = await page.evaluate(() => {
    const el = document.querySelector('.antarctica-hint-screen .hint-text');
    return el ? el.textContent.trim() : 'not found';
  });
  console.log('TARGET hint text:', targetText.substring(0, 300));
  console.log('TARGET hint text length:', targetText.length);

  // Draft
  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const draftText = await page.evaluate(() => {
    const el = document.querySelector('.hint-text');
    return el ? el.textContent.trim() : 'not found';
  });
  console.log('DRAFT hint text:', draftText.substring(0, 300));
  console.log('DRAFT hint text length:', draftText.length);

  await browser.close();
})();
