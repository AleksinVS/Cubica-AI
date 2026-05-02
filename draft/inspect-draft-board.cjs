const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const cards = await page.evaluate(() => {
    const all = document.querySelectorAll('.cards-container .game-card, .cards-container .default-game-card');
    return Array.from(all).map(c => ({
      class: c.className,
      rect: c.getBoundingClientRect(),
      bg: getComputedStyle(c).backgroundColor,
      color: getComputedStyle(c).color,
      text: c.textContent.slice(0, 30),
    }));
  });
  console.log('Draft cards:');
  cards.forEach((c, i) => console.log(`  ${i}: class="${c.class}" rect=(${c.rect.x},${c.rect.y},${c.rect.width},${c.rect.height}) bg=${c.bg} text="${c.text}"`));

  // Stack at (1200,600)
  const stack = await page.evaluate(() => {
    const elements = document.elementsFromPoint(1200, 600);
    return elements.slice(0, 8).map(e => ({
      tag: e.tagName,
      cls: e.className,
      bg: getComputedStyle(e).backgroundColor,
      color: getComputedStyle(e).color,
    }));
  });
  console.log('\nStack at (1200,600):');
  stack.forEach((e, i) => console.log(`  ${i}: <${e.tag}> class="${e.cls}" bg=${e.bg} color=${e.color}`));

  await browser.close();
}

main().catch(console.error);
