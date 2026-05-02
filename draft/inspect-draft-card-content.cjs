const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Inspect the card at (1200,600) specifically
  const info = await page.evaluate(() => {
    const x = 1200, y = 600;
    const card = document.elementsFromPoint(x, y).find(e => e.classList.contains('game-card'));
    if (!card) return { error: 'no card found' };
    
    const children = Array.from(card.children).map(c => ({
      tag: c.tagName,
      cls: c.className,
      rect: c.getBoundingClientRect(),
      bg: getComputedStyle(c).backgroundColor,
      img: c.querySelector('img') ? c.querySelector('img').src.slice(-30) : null,
    }));
    
    // Also get the exact element at the point
    const exact = document.elementsFromPoint(x, y)[0];
    
    return {
      cardClass: card.className,
      exactElement: { tag: exact.tagName, cls: exact.className, text: exact.textContent.slice(0,30) },
      children,
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
