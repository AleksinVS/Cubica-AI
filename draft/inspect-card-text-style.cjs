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

  const draftStyle = await page.evaluate(() => {
    const card = document.querySelector('.cards-container .game-card');
    const s = getComputedStyle(card);
    return {
      padding: s.padding,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      fontFamily: s.fontFamily,
      width: s.width,
    };
  });
  console.log('Draft card:', draftStyle);

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

  const targetStyle = await page.evaluate(() => {
    const card = document.querySelector('.cards-container .s1-card');
    const text = card?.querySelector('.s1-card-text');
    const s = card ? getComputedStyle(card) : null;
    const ts = text ? getComputedStyle(text) : null;
    return {
      card: s ? {
        padding: s.padding,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        fontFamily: s.fontFamily,
        width: s.width,
      } : null,
      text: ts ? {
        margin: ts.margin,
        fontSize: ts.fontSize,
        lineHeight: ts.lineHeight,
        fontFamily: ts.fontFamily,
      } : null,
    };
  });
  console.log('Target card:', JSON.stringify(targetStyle, null, 2));

  await browser.close();
}

main().catch(console.error);
