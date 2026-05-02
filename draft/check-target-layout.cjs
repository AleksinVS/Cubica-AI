const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const main = document.querySelector('.topbar-screen-shell .main-content-area');
    const btns = document.querySelector('.topbar-screen-shell .button-container');
    const screen = document.querySelector('.topbar-screen-shell');
    const sMain = main ? getComputedStyle(main) : null;
    const sBtns = btns ? getComputedStyle(btns) : null;
    const sScreen = screen ? getComputedStyle(screen) : null;
    return {
      main: main ? {
        rect: main.getBoundingClientRect(),
        marginBottom: sMain.marginBottom,
        paddingBottom: sMain.paddingBottom,
        gridRow: sMain.gridRow,
        gridColumn: sMain.gridColumn,
      } : null,
      btns: btns ? {
        rect: btns.getBoundingClientRect(),
        marginTop: sBtns.marginTop,
        paddingTop: sBtns.paddingTop,
        gridRow: sBtns.gridRow,
        gridColumn: sBtns.gridColumn,
      } : null,
      screen: screen ? {
        rect: screen.getBoundingClientRect(),
        gridTemplateRows: sScreen.gridTemplateRows,
        gridTemplateColumns: sScreen.gridTemplateColumns,
      } : null,
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
