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

  const styles = await page.evaluate(() => {
    const container = document.querySelector('.topbar-screen-shell .cards-container');
    const main = document.querySelector('.topbar-screen-shell .main-content-area');
    const cards = document.querySelectorAll('.topbar-screen-shell .cards-container > .s1-card');
    const c = container ? getComputedStyle(container) : null;
    const m = main ? getComputedStyle(main) : null;
    const cardStyles = Array.from(cards).map(card => {
      const s = getComputedStyle(card);
      return {
        height: s.height,
        minHeight: s.minHeight,
        alignSelf: s.alignSelf,
        flexGrow: s.flexGrow,
        flexShrink: s.flexShrink,
        flexBasis: s.flexBasis,
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
        lineHeight: s.lineHeight,
        fontSize: s.fontSize,
        boxSizing: s.boxSizing,
        display: s.display,
      };
    });
    return {
      container: c ? {
        display: c.display,
        flexWrap: c.flexWrap,
        alignItems: c.alignItems,
        alignContent: c.alignContent,
        justifyContent: c.justifyContent,
        gap: c.gap,
        padding: c.padding,
        height: c.height,
        minHeight: c.minHeight,
        maxHeight: c.maxHeight,
        boxSizing: c.boxSizing,
        flexDirection: c.flexDirection,
      } : null,
      main: m ? {
        display: m.display,
        flexDirection: m.flexDirection,
        alignItems: m.alignItems,
        gap: m.gap,
        height: m.height,
        minHeight: m.minHeight,
        padding: m.padding,
      } : null,
      cards: cardStyles,
    };
  });

  console.log(JSON.stringify(styles, null, 2));
  await browser.close();
}

main().catch(console.error);
