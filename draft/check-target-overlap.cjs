const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Visit draft first to reset state
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
    const main = document.querySelector('.topbar-screen-shell .main-content-area');
    const btns = document.querySelector('.topbar-screen-shell .button-container');
    const addBg = document.querySelector('.topbar-screen-shell .additional-background');
    const screen = document.querySelector('.topbar-screen-shell');
    const sMain = main ? getComputedStyle(main) : null;
    const sBtns = btns ? getComputedStyle(btns) : null;
    const sAddBg = addBg ? getComputedStyle(addBg) : null;
    const sScreen = screen ? getComputedStyle(screen) : null;
    return {
      main: {
        rect: main?.getBoundingClientRect(),
        marginTop: sMain?.marginTop,
        marginBottom: sMain?.marginBottom,
        paddingBottom: sMain?.paddingBottom,
        position: sMain?.position,
      },
      btns: {
        rect: btns?.getBoundingClientRect(),
        marginTop: sBtns?.marginTop,
        marginBottom: sBtns?.marginBottom,
        paddingTop: sBtns?.paddingTop,
        paddingBottom: sBtns?.paddingBottom,
        position: sBtns?.position,
      },
      addBg: {
        rect: addBg?.getBoundingClientRect(),
        marginTop: sAddBg?.marginTop,
        marginBottom: sAddBg?.marginBottom,
        gridRow: sAddBg?.gridRow,
      },
      screen: {
        rect: screen?.getBoundingClientRect(),
        gridTemplateRows: sScreen?.gridTemplateRows,
        gridTemplateColumns: sScreen?.gridTemplateColumns,
      },
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
