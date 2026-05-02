const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); } else break;
  }
  await page.waitForTimeout(1000);

  const containers = await page.evaluate(() => {
    const els = document.querySelectorAll('.cards-container');
    return Array.from(els).map(c => ({
      class: c.className,
      rect: c.getBoundingClientRect(),
      childCount: c.children.length,
      firstChildClass: c.children[0] ? c.children[0].className : null,
    }));
  });
  console.log('Cards containers:');
  containers.forEach((c, i) => console.log(`  ${i}: class="${c.class}" rect=(${c.rect.x},${c.rect.y}) children=${c.childCount} first="${c.firstChildClass}"`));

  const cardHTML = await page.evaluate(() => {
    const card = document.querySelector('.antarctica-fallback-card');
    return card ? card.outerHTML : 'not found';
  });
  console.log('\nFirst antarctica-fallback-card HTML:');
  console.log(cardHTML.slice(0, 1500));

  await browser.close();
}

main().catch(console.error);
