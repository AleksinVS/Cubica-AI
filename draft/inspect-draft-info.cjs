const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Info screen is the initial screen, don't click anything
  const hasAdditionalBg = await page.evaluate(() => !!document.querySelector('.additional-background'));
  const stack = await page.evaluate(() => {
    const elements = document.elementsFromPoint(900, 500);
    return elements.slice(0, 6).map(e => ({
      tag: e.tagName,
      cls: e.className,
      bg: getComputedStyle(e).backgroundColor,
    }));
  });
  console.log('Has .additional-background:', hasAdditionalBg);
  console.log('Stack at (900,500):');
  stack.forEach((e, i) => console.log(`  ${i}: <${e.tag}> class="${e.cls}" bg=${e.bg}`));

  await browser.close();
}

main().catch(console.error);
