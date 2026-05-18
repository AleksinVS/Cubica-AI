const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });

  // Draft
  const draftPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await draftPage.goto("http://localhost:3000/?fixture=journal", { waitUntil: "networkidle" });
  await draftPage.waitForTimeout(3000);

  const draftStyles = await draftPage.evaluate(() => {
    const h1 = document.querySelector('.heading-h1');
    const card = document.querySelector('.game-card');
    const text = document.querySelector('.game-card');
    const vars = document.querySelector('.journal-variables-container');
    return {
      h1: h1 ? {
        fontSize: window.getComputedStyle(h1).fontSize,
        fontWeight: window.getComputedStyle(h1).fontWeight,
        lineHeight: window.getComputedStyle(h1).lineHeight,
        padding: window.getComputedStyle(h1).padding,
        margin: window.getComputedStyle(h1).margin,
      } : null,
      card: card ? {
        padding: window.getComputedStyle(card).padding,
        fontSize: window.getComputedStyle(card).fontSize,
        fontWeight: window.getComputedStyle(card).fontWeight,
        lineHeight: window.getComputedStyle(card).lineHeight,
        backgroundColor: window.getComputedStyle(card).backgroundColor,
      } : null,
      vars: vars ? {
        display: window.getComputedStyle(vars).display,
        flexDirection: window.getComputedStyle(vars).flexDirection,
        gap: window.getComputedStyle(vars).gap,
      } : null,
    };
  });
  console.log("Draft styles:", JSON.stringify(draftStyles, null, 2));

  // Target
  const targetPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await targetPage.goto("http://localhost:3003");
  await targetPage.evaluate((sid) => { localStorage.setItem('cubica-antarctica-session-id', sid); }, 'session-1778923560304-ltyfzk');
  await targetPage.reload({ waitUntil: "networkidle" });
  await targetPage.waitForTimeout(3000);
  const journalBtn = await targetPage.$('text=журнал ходов');
  if (journalBtn) await journalBtn.click();
  await targetPage.waitForTimeout(2000);

  const targetStyles = await targetPage.evaluate(() => {
    const h1 = document.querySelector('.heading-h1');
    const card = document.querySelector('.journal-entry-card');
    const text = document.querySelector('.journal-entry-text');
    const vars = document.querySelector('.journal-variables-container');
    return {
      h1: h1 ? {
        fontSize: window.getComputedStyle(h1).fontSize,
        fontWeight: window.getComputedStyle(h1).fontWeight,
        lineHeight: window.getComputedStyle(h1).lineHeight,
        padding: window.getComputedStyle(h1).padding,
        margin: window.getComputedStyle(h1).margin,
      } : null,
      card: card ? {
        padding: window.getComputedStyle(card).padding,
        fontSize: window.getComputedStyle(card).fontSize,
        fontWeight: window.getComputedStyle(card).fontWeight,
        lineHeight: window.getComputedStyle(card).lineHeight,
        backgroundColor: window.getComputedStyle(card).backgroundColor,
      } : null,
      text: text ? {
        fontSize: window.getComputedStyle(text).fontSize,
        lineHeight: window.getComputedStyle(text).lineHeight,
      } : null,
      vars: vars ? {
        display: window.getComputedStyle(vars).display,
        flexDirection: window.getComputedStyle(vars).flexDirection,
        gap: window.getComputedStyle(vars).gap,
      } : null,
    };
  });
  console.log("Target styles:", JSON.stringify(targetStyles, null, 2));

  await browser.close();
})();
