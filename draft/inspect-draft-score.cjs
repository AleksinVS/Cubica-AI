const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const el = document.querySelector('.default-main-screen .game-variables-container .game-variable--score');
    if (!el) return { error: 'No score var found' };
    const s = getComputedStyle(el);
    const btn = el.querySelector('button');
    const bs = btn ? getComputedStyle(btn) : null;
    const cap = el.querySelector('div > span');
    const cs = cap ? getComputedStyle(cap) : null;
    return {
      width: s.width,
      height: s.height,
      display: s.display,
      btnWidth: bs?.width,
      btnHeight: bs?.height,
      btnColor: bs?.color,
      btnFontSize: bs?.fontSize,
      captionColor: cs?.color,
      captionFontSize: cs?.fontSize,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch(console.error);
