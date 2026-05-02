const { chromium } = require('playwright');

(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();

  console.log('Initial screen:', data.state?.public?.ui?.activeScreen);
  console.log('Initial timeline:', JSON.stringify(data.state?.public?.timeline));

  // Advance past intro
  const r2 = await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: data.sessionId, playerId: 'player-web', actionId: 'advanceIntro' })
  });
  const d2 = await r2.json();
  console.log('After advance screen:', d2.state?.public?.ui?.activeScreen);
  console.log('After advance timeline:', JSON.stringify(d2.state?.public?.timeline));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => {
    localStorage.setItem('cubica-antarctica-session-id', sid);
  }, data.sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  const info = await page.evaluate(() => {
    return {
      screen: document.querySelector('.topbar-screen-shell, .leftsidebar-screen, .info-screen-shell')?.className,
      renderer: document.querySelector('.s1-renderer')?.className,
      buttons: Array.from(document.querySelectorAll('button')).map(b => ({
        id: b.id,
        className: b.className,
        text: b.textContent.trim(),
        disabled: b.disabled,
      })),
      html: document.body.innerHTML.substring(0, 2000),
    };
  });
  console.log('DOM info:', JSON.stringify(info, null, 2));

  await browser.close();
})();
