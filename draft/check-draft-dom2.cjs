const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    return {
      html: document.body.innerHTML.slice(0, 2000),
      hasDefaultMain: !!document.querySelector('.default-main-screen'),
      hasCardsContainer: !!document.querySelector('.cards-container'),
      hasGameVariables: !!document.querySelector('.game-variables-container'),
      cardCount: document.querySelectorAll('.cards-container .game-card').length,
      varCount: document.querySelectorAll('.game-variables-container .game-variable').length,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(console.error);
