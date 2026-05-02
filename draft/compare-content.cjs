const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function extractContent(page, url, advanceToBoard = false) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url, { waitUntil: 'networkidle' });

  if (advanceToBoard) {
    for (let i = 0; i < 12; i++) {
      const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
      if (cards.length >= 4) break;
      const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
      if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
    }
  }
  await page.waitForTimeout(1000);

  return await page.evaluate(() => {
    const boardTitle = document.querySelector('.topbar-board-header .s1-card-text, .default-board-header .s1-card-text')?.textContent?.trim() || '';
    const cardTexts = Array.from(document.querySelectorAll('.cards-container .s1-card-text, .cards-container .game-card-text')).map(el => el.textContent?.trim()).filter(Boolean);
    const varCaptions = Array.from(document.querySelectorAll('.game-variables-container .game-variable-caption')).map(el => el.textContent?.trim());
    const varValues = Array.from(document.querySelectorAll('.game-variables-container .game-variable-value')).map(el => el.textContent?.trim());
    return { boardTitle, cardTexts, varCaptions, varValues };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const draft = await extractContent(page, DRAFT_URL, false);
  const target = await extractContent(page, TARGET_URL, true);

  console.log('DRAFT:', JSON.stringify(draft, null, 2));
  console.log('\nTARGET:', JSON.stringify(target, null, 2));

  await browser.close();
}

main().catch(console.error);
