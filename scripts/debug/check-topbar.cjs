const { chromium } = require("playwright");
const { createBrowserBffSessionClient } = require("./runtime-command-client.cjs");

const targetUrl = "http://localhost:3003";

async function createSession(page) {
  const runtime = await createBrowserBffSessionClient(page, "antarctica");
  for (const actionId of ["opening.info.i0.advance", "opening.info.i02.advance", "opening.info.i03.advance", "opening.info.i1.advance", "opening.info.i2.advance", "opening.info.i3.advance", "opening.info.i4.advance", "opening.info.i5.advance", "opening.info.i6.advance"]) {
    await runtime.dispatch(actionId);
  }
  for (const actionId of ["opening.card.1", "opening.card.2"]) {
    await runtime.dispatch(actionId);
  }
  return runtime.sessionId;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto(targetUrl, { waitUntil: "networkidle" });
  const sessionId = await createSession(page);
  await page.evaluate((sid) => { localStorage.setItem('cubica-antarctica-session-id', sid); }, sessionId);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const journalBtn = await page.$('text=журнал ходов');
  if (journalBtn) await journalBtn.click();
  await page.waitForTimeout(2000);

  // Get all elements in top 150px
  const topElements = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const result = [];
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.top < 150 && rect.height > 10 && rect.width > 10) {
        result.push({
          tag: el.tagName,
          classes: el.className,
          text: el.innerText?.substring(0, 30) || '',
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        });
      }
    }
    return result;
  });
  console.log("Top elements:", JSON.stringify(topElements.slice(0, 20), null, 2));

  await browser.close();
})();
