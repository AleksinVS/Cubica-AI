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

  const sel = '.leftsidebar-screen .game-variable--score';
  const el = await page.$(sel);
  if (!el) { console.log('NOT FOUND'); await browser.close(); return; }
  const styles = await el.evaluate((node) => {
    const cs = window.getComputedStyle(node);
    return {
      height: cs.height,
      minHeight: cs.minHeight,
      maxHeight: cs.maxHeight,
      boxSizing: cs.boxSizing,
      paddingTop: cs.paddingTop,
      paddingBottom: cs.paddingBottom,
      borderTopWidth: cs.borderTopWidth,
      borderBottomWidth: cs.borderBottomWidth,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      alignSelf: cs.alignSelf,
      flexGrow: cs.flexGrow,
      flexShrink: cs.flexShrink,
      flexBasis: cs.flexBasis,
      overflow: cs.overflow,
      position: cs.position,
      display: cs.display,
      lineHeight: cs.lineHeight,
      fontSize: cs.fontSize,
    };
  });
  console.log(JSON.stringify(styles, null, 2));

  // Also get the element's bounding rect
  const rect = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { width: r.width, height: r.height, top: r.top, left: r.left };
  });
  console.log('Bounding rect:', JSON.stringify(rect, null, 2));

  await browser.close();
})();
