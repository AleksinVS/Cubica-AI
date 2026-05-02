const { chromium } = require('playwright');

const DRAFT_URL = 'http://localhost:4000?local=true';
const TARGET_URL = 'http://localhost:3000';

async function getCardStyles(page, label) {
  const info = await page.evaluate(() => {
    const card = document.querySelector('.cards-container .game-card, .cards-container .s1-card');
    if (!card) return null;
    const s = getComputedStyle(card);
    return {
      padding: s.padding,
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      color: s.color,
      backgroundColor: s.backgroundColor,
      borderRadius: s.borderRadius,
      border: s.border,
      boxShadow: s.boxShadow,
      width: s.width,
      height: s.height,
      textAlign: s.textAlign,
      textTransform: s.textTransform,
      letterSpacing: s.letterSpacing,
    };
  });
  console.log(`=== ${label} card styles ===`);
  console.log(JSON.stringify(info, null, 2));
}

async function getVariableStyles(page, label) {
  const info = await page.evaluate(() => {
    const v = document.querySelector('.game-variable, .antarctica-variable');
    if (!v) return null;
    const s = getComputedStyle(v);
    const img = v.querySelector('div[class*="image"], div[class*="visual"]');
    const imgS = img ? getComputedStyle(img) : null;
    return {
      variable: {
        display: s.display,
        flexDirection: s.flexDirection,
        justifyContent: s.justifyContent,
        alignItems: s.alignItems,
        color: s.color,
        fontWeight: s.fontWeight,
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        textTransform: s.textTransform,
        textAlign: s.textAlign,
        gap: s.gap,
        padding: s.padding,
        margin: s.margin,
      },
      image: imgS ? {
        width: imgS.width,
        height: imgS.height,
        backgroundImage: imgS.backgroundImage.slice(0, 60),
        backgroundSize: imgS.backgroundSize,
        backgroundRepeat: imgS.backgroundRepeat,
        flex: imgS.flex,
        flexBasis: imgS.flexBasis,
      } : null,
    };
  });
  console.log(`=== ${label} variable styles ===`);
  console.log(JSON.stringify(info, null, 2));
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  const draftPage = await browser.newPage();
  await draftPage.setViewportSize({ width: 1920, height: 1080 });
  await draftPage.goto(DRAFT_URL, { waitUntil: 'networkidle' });
  await draftPage.waitForTimeout(2000);
  await getCardStyles(draftPage, 'DRAFT');
  await getVariableStyles(draftPage, 'DRAFT');

  const targetPage = await browser.newPage();
  await targetPage.setViewportSize({ width: 1920, height: 1080 });
  await targetPage.goto(TARGET_URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 12; i++) {
    const cards = await targetPage.$$('.cards-container .s1-card, .cards-container .game-card');
    if (cards.length >= 4) break;
    const btn = await targetPage.$('button:has-text("ПРОДОЛЖИТЬ"), button:has-text("Продолжить")');
    if (btn) { await btn.click(); await targetPage.waitForTimeout(3000); } else break;
  }
  await targetPage.waitForTimeout(1000);
  await getCardStyles(targetPage, 'TARGET');
  await getVariableStyles(targetPage, 'TARGET');

  await browser.close();
}

main().catch(console.error);
