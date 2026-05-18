import { chromium } from "playwright";

const baseUrl = "http://localhost:3003";

async function apiPost(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

async function captureTargetJournal() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const sessionRes = await apiPost("/api/runtime/sessions", { gameId: "antarctica", playerId: "test-journal" });
  const sessionId = sessionRes.sessionId;
  console.log("Session:", sessionId);

  await page.goto(baseUrl, { waitUntil: "networkidle" });
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
    await apiPost("/api/runtime/actions", { sessionId, playerId: "test-journal", actionId, payload: {} });
    await page.waitForTimeout(300);
  }

  // Select multiple cards to populate journal
  for (const cardId of ["1", "2", "3"]) {
    await apiPost("/api/runtime/actions", { sessionId, playerId: "test-journal", actionId: `opening.card.${cardId}`, payload: {} });
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
