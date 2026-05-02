const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const container = document.querySelector('.button-container');
    const c = getComputedStyle(container);
    const children = Array.from(container.children).map(ch => {
      const r = ch.getBoundingClientRect();
      const s = getComputedStyle(ch);
      return {
        tag: ch.tagName,
        className: ch.className,
        width: r.width,
        height: r.height,
        marginTop: s.marginTop,
        marginBottom: s.marginBottom,
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        display: s.display,
        boxSizing: s.boxSizing,
        alignSelf: s.alignSelf,
      };
    });
    return {
      container: {
        width: container.getBoundingClientRect().width,
        height: container.getBoundingClientRect().height,
        paddingTop: c.paddingTop,
        paddingBottom: c.paddingBottom,
        gap: c.gap,
        alignItems: c.alignItems,
        display: c.display,
        boxSizing: c.boxSizing,
      },
      children,
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(console.error);
