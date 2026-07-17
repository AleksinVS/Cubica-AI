const { chromium } = require("playwright");
const { createBrowserBffSessionClient } = require("./runtime-command-client.cjs");

const draftUrl = "http://localhost:3000/?fixture=journal";
const targetUrl = "http://localhost:3003";

async function createSession(page) {
  const runtime = await createBrowserBffSessionClient(page, "antarctica");
  const infoAdvances = [
    "opening.info.i0.advance", "opening.info.i02.advance", "opening.info.i03.advance",
    "opening.info.i1.advance", "opening.info.i2.advance", "opening.info.i3.advance",
    "opening.info.i4.advance", "opening.info.i5.advance", "opening.info.i6.advance"
  ];
  for (const actionId of infoAdvances) {
    await runtime.dispatch(actionId);
  }
  for (const actionId of ["opening.card.1", "opening.card.2"]) {
    await runtime.dispatch(actionId);
  }
  return runtime.sessionId;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const draftPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await draftPage.goto(draftUrl, { waitUntil: "networkidle" });
  await draftPage.waitForTimeout(3000);

  const targetPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await targetPage.goto(targetUrl, { waitUntil: "networkidle" });
  const sessionId = await createSession(targetPage);
  await targetPage.evaluate((sid) => { localStorage.setItem('cubica-antarctica-session-id', sid); }, sessionId);
  await targetPage.reload({ waitUntil: "networkidle" });
  await targetPage.waitForTimeout(3000);
  const journalBtn = await targetPage.$('text=журнал ходов');
  if (journalBtn) await journalBtn.click();
  await targetPage.waitForTimeout(2000);

  const selectors = [
    '.heading-h1',
    '.journal-container',
    '.journal-entries-list',
    '.journal-entry-card',
    '.journal-entry-columns',
    '.journal-entry-front',
    '.journal-entry-back',
    '.journal-entry-text',
    '.journal-variables-container',
    '.journal-game-variable',
    '.game-card',
    '.journal-main-content',
    '.main-screen',
    '.shell'
  ];

  for (const sel of selectors) {
    const draftEl = await draftPage.$(sel);
    const targetEl = await targetPage.$(sel);
    if (!draftEl && !targetEl) continue;

    const draftStyle = draftEl ? await draftPage.evaluate(el => {
      const s = window.getComputedStyle(el);
      return {
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        top: el.getBoundingClientRect().top,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        padding: s.padding,
        margin: s.margin,
        display: s.display,
        gap: s.gap,
        flexDirection: s.flexDirection,
        justifyContent: s.justifyContent,
        alignItems: s.alignItems,
        textAlign: s.textAlign,
        fontFamily: s.fontFamily,
      };
    }, draftEl) : null;

    const targetStyle = targetEl ? await targetPage.evaluate(el => {
      const s = window.getComputedStyle(el);
      return {
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        top: el.getBoundingClientRect().top,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        padding: s.padding,
        margin: s.margin,
        display: s.display,
        gap: s.gap,
        flexDirection: s.flexDirection,
        justifyContent: s.justifyContent,
        alignItems: s.alignItems,
        textAlign: s.textAlign,
        fontFamily: s.fontFamily,
      };
    }, targetEl) : null;

    console.log(`\n=== ${sel} ===`);
    console.log("Draft:", JSON.stringify(draftStyle, null, 2));
    console.log("Target:", JSON.stringify(targetStyle, null, 2));
  }

  await browser.close();
})();
