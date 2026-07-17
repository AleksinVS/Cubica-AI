import { chromium } from "playwright";
import runtimeCommandClient from "./runtime-command-client.cjs";

const { createBrowserBffSessionClient } = runtimeCommandClient;
const baseUrl = "http://localhost:3003";

async function captureTargetJournal() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const runtime = await createBrowserBffSessionClient(page, "antarctica");
  const sessionId = runtime.sessionId;
  console.log("Session:", sessionId);

  await page.evaluate((sid) => {
    localStorage.setItem("cubica-antarctica-session-id", sid);
  }, sessionId);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const introActions = [
    "opening.info.i0.advance", "opening.info.i02.advance", "opening.info.i03.advance",
    "opening.info.i1.advance", "opening.info.i2.advance", "opening.info.i3.advance",
    "opening.info.i4.advance", "opening.info.i5.advance", "opening.info.i6.advance"
  ];
  for (const actionId of introActions) {
    await runtime.dispatch(actionId);
    await page.waitForTimeout(300);
  }

  // Select multiple cards to populate journal
  for (const cardId of ["1", "2", "3"]) {
    await runtime.dispatch(`opening.card.${cardId}`);
    await page.waitForTimeout(300);
  }

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const journalBtn = await page.locator('button:has-text("Журнал ходов")').first();
  if (await journalBtn.isVisible().catch(() => false)) {
    await journalBtn.click();
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: "/home/abc/projects/Cubica-AI/.tmp/screenshots/target-journal-multi.png", fullPage: false });
  console.log("Screenshot saved");

  const domInfo = await page.evaluate(() => {
    const entries = document.querySelectorAll(".journal-entry-card");
    const scrollable = document.querySelector(".journal-main-content");
    return {
      entryCount: entries.length,
      journalMainContentOverflow: scrollable ? window.getComputedStyle(scrollable).overflowY : null,
      journalMainContentHeight: scrollable ? scrollable.clientHeight : null,
      journalMainContentScrollHeight: scrollable ? scrollable.scrollHeight : null,
    };
  });
  console.log("DOM info:", domInfo);

  await browser.close();
}

captureTargetJournal().catch((err) => {
  console.error(err);
  process.exit(1);
});
