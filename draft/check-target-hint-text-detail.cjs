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
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showHint' })
  });

  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const el = document.querySelector('.antarctica-hint-screen .hint-text');
    if (!el) return { error: 'not found' };
    const cs = window.getComputedStyle(el);
    return {
      text: el.textContent.trim().substring(0, 500),
      textLength: el.textContent.length,
      innerHTML: el.innerHTML.substring(0, 200),
      rect: el.getBoundingClientRect(),
      cs: {
        whiteSpace: cs.whiteSpace,
        wordBreak: cs.wordBreak,
        overflowWrap: cs.overflowWrap,
        marginTop: cs.marginTop,
        marginBottom: cs.marginBottom,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        width: cs.width,
        height: cs.height,
      }
    };
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
