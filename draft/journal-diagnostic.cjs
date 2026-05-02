const { chromium } = require('playwright');
const fs = require('fs');
const { PNG } = require('pngjs');

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
    body: JSON.stringify({ sessionId, playerId: 'player-web', actionId: 'showHistory' })
  });

  await page.goto('http://localhost:3009', { waitUntil: 'networkidle' });
  await page.evaluate((sid) => localStorage.setItem('cubica-antarctica-session-id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const styles = await page.evaluate(() => {
    const card = document.querySelector('.journal-entry-card');
    if (!card) return null;
    const cs = getComputedStyle(card);
    return {
      backgroundColor: cs.backgroundColor,
      background: cs.background,
      opacity: cs.opacity,
      classList: Array.from(card.classList),
      rect: { top: card.getBoundingClientRect().top, left: card.getBoundingClientRect().left, width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height },
      parentBg: window.getComputedStyle(card.parentElement).backgroundColor,
    };
  });
  console.log('Computed styles:', JSON.stringify(styles, null, 2));

  await page.screenshot({ path: '/tmp/target-journal-debug.png' });
  const png = PNG.sync.read(fs.readFileSync('/tmp/target-journal-debug.png'));
  const coords = [
    { x: 500, y: 150, label: 'inside card' },
    { x: 500, y: 300, label: 'inside card lower' },
    { x: 960, y: 540, label: 'center' },
  ];
  for (const { x, y, label } of coords) {
    const idx = (y * 1920 + x) * 4;
    console.log(`${label} (${x},${y}): rgba(${png.data[idx]}, ${png.data[idx+1]}, ${png.data[idx+2]}, ${png.data[idx+3]})`);
  }

  await browser.close();
})();
