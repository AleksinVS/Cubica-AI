const runtimeUrl = "http://localhost:3001";

(async () => {
  const createRes = await fetch(`${runtimeUrl}/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: "antarctica", playerId: "test-player" })
  });
  const { sessionId } = await createRes.json();

  // Advance all info screens
  for (const id of ["i0", "i02", "i03", "i1", "i2", "i3", "i4", "i5", "i6"]) {
    await fetch(`${runtimeUrl}/actions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, playerId: "test-player", actionId: `opening.info.${id}.advance`, payload: {} })
    });
  }

  // card 1
  const resp = await fetch(`${runtimeUrl}/actions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, playerId: "test-player", actionId: "opening.card.1", payload: {} })
  });
  const data = await resp.json();
  console.log("Card 1 dispatch log length:", data.state?.public?.log?.length);

  // get session
  const s = await (await fetch(`${runtimeUrl}/sessions/${sessionId}`)).json();
  console.log("Session store log length:", s.state?.public?.log?.length);
})();
