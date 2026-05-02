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

  const metrics = await page.evaluate(() => {
    const vars = Array.from(document.querySelectorAll('.leftsidebar-screen .game-variable'));
    return vars.map((v, i) => {
      const cs = window.getComputedStyle(v);
      const rect = v.getBoundingClientRect();
      const img = v.querySelector('.game-variable-image');
      const imgStyle = img ? window.getComputedStyle(img) : null;
      const content = v.querySelector('.game-variable-content');
      const caption = v.querySelector('.game-variable-caption');
      const value = v.querySelector('.game-variable-value');
      return {
        index: i,
        className: v.className,
        text: v.textContent.trim().substring(0, 100),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        computed: {
          backgroundColor: cs.backgroundColor,
          backgroundImage: cs.backgroundImage,
          color: cs.color,
          fontSize: cs.fontSize,
          fontFamily: cs.fontFamily,
          padding: cs.padding,
        },
        imageBg: imgStyle ? imgStyle.backgroundImage : null,
        contentHtml: content ? content.innerHTML : null,
        captionText: caption ? caption.textContent : null,
        valueText: value ? value.textContent : null,
      };
    });
  });

  console.log('Target sidebar metrics:', JSON.stringify(metrics, null, 2));

  await browser.close();
})();
