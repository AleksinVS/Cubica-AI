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

  // Inject a fake button inside the grid where .additional-background overlaps
  const result = await page.evaluate(() => {
    const screen = document.querySelector('.s1-screen');
    if (!screen) return { error: 'No s1-screen found' };

    // Create a fake button at grid-row 3, grid-column 2 (where .additional-background spans)
    const fakeBtn = document.createElement('button');
    fakeBtn.id = 'fake-test-button';
    fakeBtn.textContent = 'TEST';
    fakeBtn.style.cssText = 'grid-column: 2; grid-row: 3; z-index: auto; background: red; color: white; padding: 10px 20px; border: none; cursor: pointer;';
    screen.appendChild(fakeBtn);

    const rect = fakeBtn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const topEl = document.elementFromPoint(cx, cy);
    const addBg = document.querySelector('.additional-background');
    const addBgRect = addBg ? addBg.getBoundingClientRect() : null;

    return {
      fakeBtnRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      elementFromPoint: topEl ? { tag: topEl.tagName, id: topEl.id, className: topEl.className } : null,
      isClickable: topEl === fakeBtn || (topEl && fakeBtn.contains(topEl)),
      addBgOverlaps: addBgRect ? (
        addBgRect.left < rect.right && addBgRect.right > rect.left &&
        addBgRect.top < rect.bottom && addBgRect.bottom > rect.top
      ) : false,
      addBgPointerEvents: addBg ? window.getComputedStyle(addBg).pointerEvents : null,
    };
  });

  console.log('Clickthrough test:', JSON.stringify(result, null, 2));

  // Try to click the fake button
  let clicked = false;
  await page.evaluate(() => {
    const btn = document.getElementById('fake-test-button');
    if (btn) {
      btn.addEventListener('click', () => {
        btn.dataset.clicked = 'true';
      });
    }
  });
  await page.click('#fake-test-button');
  clicked = await page.evaluate(() => document.getElementById('fake-test-button')?.dataset.clicked === 'true');
  console.log('Fake button click succeeded:', clicked);

  await browser.close();
})();
