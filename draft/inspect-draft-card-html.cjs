const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const html = await page.evaluate(() => {
    const cards = document.querySelectorAll('.cards-container .game-card');
    const card = cards[5]; // 6th card at (1200,600)
    return card ? card.outerHTML.slice(0, 2000) : 'not found';
  });
  console.log(html);

  await browser.close();
}

main().catch(console.error);
