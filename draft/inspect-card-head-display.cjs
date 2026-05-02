const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

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

  const styles = await page.evaluate(() => {
    const card = document.querySelector('.cards-container > .s1-card');
    if (!card) return null;
    const head = card.querySelector('.antarctica-fallback-card-head');
    const meta = card.querySelector('.antarctica-fallback-card-meta');
    const btn = card.querySelector('.action-button');
    const text = card.querySelector('.s1-card-text');
    return {
      headDisplay: head ? getComputedStyle(head).display : null,
      metaDisplay: meta ? getComputedStyle(meta).display : null,
      btnDisplay: btn ? getComputedStyle(btn).display : null,
      textMargin: text ? getComputedStyle(text).margin : null,
      cardHeight: card.getBoundingClientRect().height,
    };
  });
  console.log(JSON.stringify(styles, null, 2));

  await browser.close();
}

main().catch(console.error);
