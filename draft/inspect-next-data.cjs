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

  const nextData = await page.evaluate(() => {
    const data = window.__NEXT_DATA__;
    if (!data) return null;
    const props = data.props?.pageProps;
    if (!props) return null;
    const cards = props.content?.cards;
    const sample = cards ? (cards[3] || cards[0]) : null;
    return {
      contentKeys: Object.keys(props),
      hasCards: !!cards,
      cardSample: sample,
    };
  });
  console.log(JSON.stringify(nextData, null, 2));

  await browser.close();
}

main().catch(console.error);
