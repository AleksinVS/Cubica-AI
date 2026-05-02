const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const draftInfo = await page.evaluate(() => {
    const card = document.querySelector('.cards-container .game-card');
    const textNode = card?.childNodes[0];
    const range = document.createRange();
    range.selectNodeContents(card);
    const rects = range.getClientRects();
    return {
      cardHeight: card?.getBoundingClientRect().height,
      textHeight: card?.scrollHeight,
      lineCount: rects.length,
    };
  });
  console.log('Draft:', draftInfo);

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  try {
    await page.waitForSelector('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить"), .cards-container > .s1-card', { timeout: 15000 });
  } catch {}

  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container > *');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const targetInfo = await page.evaluate(() => {
    const card = document.querySelector('.cards-container > .s1-card');
    const text = card?.querySelector('.s1-card-text');
    const range = document.createRange();
    range.selectNodeContents(text || card);
    const rects = range.getClientRects();
    return {
      cardHeight: card?.getBoundingClientRect().height,
      textHeight: text?.getBoundingClientRect().height,
      lineCount: rects.length,
    };
  });
  console.log('Target:', targetInfo);

  await browser.close();
}

main().catch(console.error);
