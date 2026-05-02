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

  const info = await page.evaluate(() => {
    const card = document.querySelector('.leftsidebar-screen .cards-container > .s1-card');
    if (!card) return { error: 'card not found' };
    const textEl = card.querySelector('.s1-card-text');
    const cs = textEl ? window.getComputedStyle(textEl) : null;
    return {
      cardRect: card.getBoundingClientRect(),
      textRect: textEl ? textEl.getBoundingClientRect() : null,
      textContent: textEl ? textEl.textContent.trim().substring(0, 100) : null,
      computed: cs ? {
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        color: cs.color,
        padding: cs.padding,
        margin: cs.margin,
      } : null,
    };
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
