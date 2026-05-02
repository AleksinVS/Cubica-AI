const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Elements at bottom center
  const stack = await page.evaluate(() => {
    const elements = document.elementsFromPoint(960, 1020);
    return elements.slice(0, 8).map(e => ({
      tag: e.tagName,
      cls: e.className,
      rect: e.getBoundingClientRect(),
      bg: getComputedStyle(e).backgroundColor,
    }));
  });
  console.log('Stack at (960,1020):');
  stack.forEach((e, i) => console.log(`  ${i}: <${e.tag}> class="${e.cls}" rect=(${e.rect.x},${e.rect.y},${e.rect.width},${e.rect.height}) bg=${e.bg}`));

  // Check if there are any buttons at the bottom
  const buttons = await page.evaluate(() => {
    const all = document.querySelectorAll('button');
    return Array.from(all).map(b => ({
      text: b.textContent.slice(0, 20),
      rect: b.getBoundingClientRect(),
      cls: b.className,
    }));
  });
  console.log('\nAll buttons:');
  buttons.forEach((b, i) => console.log(`  ${i}: text="${b.text}" rect=(${b.rect.x},${b.rect.y},${b.rect.w},${b.rect.h}) class="${b.cls}"`));

  await browser.close();
}

main().catch(console.error);
