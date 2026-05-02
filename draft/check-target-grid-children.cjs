const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Visit draft first to set shared state
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const screen = document.querySelector('.topbar-screen-shell');
    if (!screen) return { error: 'No topbar-screen-shell found', html: document.body.innerHTML.substring(0, 500) };
    const children = Array.from(screen.children).map(child => {
      const r = child.getBoundingClientRect();
      const s = getComputedStyle(child);
      return {
        tag: child.tagName,
        className: child.className,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom },
        gridRow: s.gridRow,
        gridColumn: s.gridColumn,
        marginTop: s.marginTop,
        marginBottom: s.marginBottom,
        zIndex: s.zIndex,
      };
    });
    const sScreen = getComputedStyle(screen);
    return {
      screen: {
        gridTemplateRows: sScreen.gridTemplateRows,
        gridTemplateColumns: sScreen.gridTemplateColumns,
      },
      children,
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
