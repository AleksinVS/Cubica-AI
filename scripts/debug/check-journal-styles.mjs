import { chromium } from "playwright";

const runtimeUrl = "http://localhost:3001";
const playerWebUrl = "http://localhost:3003";

async function createSession() {
  const createRes = await fetch(`${runtimeUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: "antarctica", playerId: "test-player" })
  });
  const session = await createRes.json();

  const infoAdvances = [
    "opening.info.i0.advance", "opening.info.i02.advance", "opening.info.i03.advance",
    "opening.info.i1.advance", "opening.info.i2.advance", "opening.info.i3.advance",
    "opening.info.i4.advance", "opening.info.i5.advance", "opening.info.i6.advance"
  ];
  for (const actionId of infoAdvances) {
    await fetch(`${runtimeUrl}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, playerId: "test-player", actionId, payload: {} })
    });
  }

  for (const actionId of ["opening.card.1", "opening.card.2", "opening.card.3"]) {
    await fetch(`${runtimeUrl}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, playerId: "test-player", actionId, payload: {} })
    });
  }
  return session.sessionId;
}

(async () => {
  const sessionId = await createSession();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto(playerWebUrl);
  await page.evaluate((sid) => { localStorage.setItem('cubica-antarctica-session-id', sid); }, sessionId);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const journalBtn = await page.$('text=журнал ходов');
  if (journalBtn) await journalBtn.click();
  await page.waitForTimeout(2000);

  // Wait for journal entry card
  await page.waitForSelector('.journal-entry-card');

  const computed = await page.evaluate(() => {
    const card = document.querySelector('.journal-entry-card');
    const s = window.getComputedStyle(card);
    return {
      backgroundColor: s.backgroundColor,
      borderRadius: s.borderRadius,
      border: s.border,
      boxShadow: s.boxShadow,
      padding: s.padding,
      display: s.display,
      backgroundImage: s.backgroundImage,
    };
  });
  console.log("journal-entry-card computed:", JSON.stringify(computed, null, 2));

  const listComputed = await page.evaluate(() => {
    const list = document.querySelector('.journal-entries-list');
    const s = window.getComputedStyle(list);
    return {
      display: s.display,
      flexDirection: s.flexDirection,
      gridTemplateColumns: s.gridTemplateColumns,
      gap: s.gap,
    };
  });
  console.log("journal-entries-list computed:", JSON.stringify(listComputed, null, 2));

  const varsComputed = await page.evaluate(() => {
    const vc = document.querySelector('.journal-variables-container');
    const s = window.getComputedStyle(vc);
    return {
      display: s.display,
      flexDirection: s.flexDirection,
      flexWrap: s.flexWrap,
      gap: s.gap,
    };
  });
  console.log("journal-variables-container computed:", JSON.stringify(varsComputed, null, 2));

  await page.screenshot({ path: "/home/abc/projects/Cubica-AI/.tmp/screenshots/player-web-journal-check.png" });

  await browser.close();
})();
