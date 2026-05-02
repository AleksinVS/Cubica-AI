const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // --- TARGET ---
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

  const targetInfo = await page.evaluate(() => {
    const screen = document.querySelector('.antarctica-hint-screen');
    if (!screen) return { error: 'hint screen not found' };
    const rect = screen.getBoundingClientRect();
    const children = Array.from(screen.children).map(c => ({
      tag: c.tagName,
      className: c.className,
      id: c.id,
      rect: c.getBoundingClientRect(),
    }));
    const hintCard = screen.querySelector('.hint-card');
    const hintArea = screen.querySelector('.hint-area');
    const hintText = screen.querySelector('.hint-text');
    const buttons = Array.from(screen.querySelectorAll('button')).map(b => ({
      className: b.className,
      id: b.id,
      text: b.textContent.trim().substring(0, 50),
      rect: b.getBoundingClientRect(),
    }));
    const vars = screen.querySelector('.game-variables-container');
    return {
      screenRect: rect,
      children: children.map(c => ({ tag: c.tag, className: c.className, id: c.id, rect: c.rect })),
      hintCardRect: hintCard ? hintCard.getBoundingClientRect() : null,
      hintAreaStyle: hintArea ? {
        rect: hintArea.getBoundingClientRect(),
        cs: {
          width: getComputedStyle(hintArea).width,
          height: getComputedStyle(hintArea).height,
          minHeight: getComputedStyle(hintArea).minHeight,
          padding: getComputedStyle(hintArea).padding,
          display: getComputedStyle(hintArea).display,
          alignItems: getComputedStyle(hintArea).alignItems,
          justifyContent: getComputedStyle(hintArea).justifyContent,
          backgroundColor: getComputedStyle(hintArea).backgroundColor,
        }
      } : null,
      hintTextStyle: hintText ? {
        rect: hintText.getBoundingClientRect(),
        cs: {
          color: getComputedStyle(hintText).color,
          fontWeight: getComputedStyle(hintText).fontWeight,
          fontSize: getComputedStyle(hintText).fontSize,
          lineHeight: getComputedStyle(hintText).lineHeight,
        }
      } : null,
      buttons,
      varsRect: vars ? vars.getBoundingClientRect() : null,
    };
  });

  console.log('=== TARGET HINT ===');
  console.log(JSON.stringify(targetInfo, null, 2));

  // --- DRAFT ---
  await page.goto('http://localhost:4000?local=true', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const draftInfo = await page.evaluate(() => {
    const screen = document.querySelector('.main-screen');
    if (!screen) return { error: 'main-screen not found' };
    const rect = screen.getBoundingClientRect();
    const children = Array.from(screen.children).map(c => ({
      tag: c.tagName,
      className: c.className,
      id: c.id,
      rect: c.getBoundingClientRect(),
    }));
    const hintArea = screen.querySelector('.hint-area');
    const hintText = screen.querySelector('.hint-text');
    const buttons = Array.from(screen.querySelectorAll('button')).map(b => ({
      className: b.className,
      id: b.id,
      text: b.textContent.trim().substring(0, 50),
      rect: b.getBoundingClientRect(),
    }));
    const vars = screen.querySelector('.game-variables-container');
    return {
      screenRect: rect,
      children: children.map(c => ({ tag: c.tag, className: c.className, id: c.id, rect: c.rect })),
      hintAreaStyle: hintArea ? {
        rect: hintArea.getBoundingClientRect(),
        cs: {
          width: getComputedStyle(hintArea).width,
          height: getComputedStyle(hintArea).height,
          minHeight: getComputedStyle(hintArea).minHeight,
          padding: getComputedStyle(hintArea).padding,
          display: getComputedStyle(hintArea).display,
          alignItems: getComputedStyle(hintArea).alignItems,
          justifyContent: getComputedStyle(hintArea).justifyContent,
          backgroundColor: getComputedStyle(hintArea).backgroundColor,
        }
      } : null,
      hintTextStyle: hintText ? {
        rect: hintText.getBoundingClientRect(),
        cs: {
          color: getComputedStyle(hintText).color,
          fontWeight: getComputedStyle(hintText).fontWeight,
          fontSize: getComputedStyle(hintText).fontSize,
          lineHeight: getComputedStyle(hintText).lineHeight,
        }
      } : null,
      buttons,
      varsRect: vars ? vars.getBoundingClientRect() : null,
    };
  });

  console.log('\n=== DRAFT HINT ===');
  console.log(JSON.stringify(draftInfo, null, 2));

  await browser.close();
})();
