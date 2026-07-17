const { chromium } = require("playwright");
const { createBrowserBffSessionClient } = require("./runtime-command-client.cjs");

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
  const targetPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await targetPage.goto(targetUrl, { waitUntil: "networkidle" });
  const sessionId = await createSession(targetPage);
  await targetPage.evaluate((sid) => { localStorage.setItem('cubica-antarctica-session-id', sid); }, sessionId);
  await targetPage.reload({ waitUntil: "networkidle" });
  await targetPage.waitForTimeout(3000);
  const journalBtn = await targetPage.$('text=журнал ходов');
  if (journalBtn) await journalBtn.click();
  await targetPage.waitForTimeout(2000);

  const html = await targetPage.evaluate(() => {
    const shell = document.querySelector('.shell');
    if (!shell) return 'no shell';
    const classes = Array.from(shell.classList);
    const computed = window.getComputedStyle(shell);
    return {
      classes,
      padding: computed.padding,
      display: computed.display,
      gap: computed.gap,
      parentTag: shell.parentElement?.tagName,
      parentClass: shell.parentElement?.className,
      children: Array.from(shell.children).map(c => ({ tag: c.tagName, class: c.className, id: c.id }))
    };
  });
  console.log(JSON.stringify(html, null, 2));
  await browser.close();
})();
