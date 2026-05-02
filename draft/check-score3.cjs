const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  // Advance to board screen
  for (let i = 0; i < 12; i++) {
    const cards = await page.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) {
      console.log(`Board screen reached after ${i} clicks`);
      break;
    }
    const continueBtn = await page.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (continueBtn) {
      await continueBtn.click();
      await page.waitForTimeout(3000);
    } else {
      break;
    }
  }

  await page.waitForTimeout(1000);

  // Use CDP to get matched styles
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send('DOM.enable');
  await cdpSession.send('CSS.enable');

  const result = await page.evaluate(() => {
    const img = document.querySelector('.topbar-variables-container .game-variable--score.game-variable--topbar .game-variable-image.game-variable-visual');
    if (!img) return { error: 'Image element not found' };

    const rect = img.getBoundingClientRect();
    const parent = img.closest('.game-variable--score.game-variable--topbar');
    const parentRect = parent ? parent.getBoundingClientRect() : null;

    return {
      tagName: img.tagName,
      className: img.className,
      inlineHeight: img.style.height,
      inlineFlex: img.style.flex,
      inlineDisplay: img.style.display,
      computed: {
        width: getComputedStyle(img).width,
        height: getComputedStyle(img).height,
        minWidth: getComputedStyle(img).minWidth,
        minHeight: getComputedStyle(img).minHeight,
        display: getComputedStyle(img).display,
        flex: getComputedStyle(img).flex,
        flexBasis: getComputedStyle(img).flexBasis,
        boxSizing: getComputedStyle(img).boxSizing,
        position: getComputedStyle(img).position,
        margin: getComputedStyle(img).margin,
        padding: getComputedStyle(img).padding,
        alignSelf: getComputedStyle(img).alignSelf,
      },
      rect: { width: rect.width, height: rect.height },
      parentRect: parentRect ? { width: parentRect.width, height: parentRect.height } : null,
      parentClassName: parent ? parent.className : null,
      parentInlineHeight: parent ? parent.style.height : null,
      parentComputedHeight: parent ? getComputedStyle(parent).height : null,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

main().catch(console.error);
