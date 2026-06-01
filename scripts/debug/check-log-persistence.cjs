const runtimeUrl = "http://localhost:3001";

async function createSession() {
  const res = await fetch(`${runtimeUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: "antarctica", playerId: "test-player" })
  });
  return (await res.json()).sessionId;
}

async function dispatch(sessionId, actionId) {
  const res = await fetch(`${runtimeUrl}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, playerId: "test-player", actionId, payload: {} })
  });
  return await res.json();
}

async function getSession(sessionId) {
  const res = await fetch(`${runtimeUrl}/sessions/${sessionId}`);
  return await res.json();
}

(async () => {
  const sid = await createSession();
  console.log("Session created:", sid);

  // Advance info screens
  for (const id of ["i0", "i02", "i03", "i1", "i2", "i3", "i4", "i5", "i6"]) {
    await dispatch(sid, `opening.info.${id}.advance`);
  }

  let s = await getSession(sid);
  console.log("After info advances, log length:", s.state.public.log?.length ?? 0);

  // Select card 1
  await dispatch(sid, "opening.card.1");
  s = await getSession(sid);
  console.log("After card 1, log length:", s.state.public.log?.length ?? 0);
  console.log("Last log entry kind:", s.state.public.log?.[s.state.public.log.length - 1]?.kind);

  // Select card 2
  await dispatch(sid, "opening.card.2");
  s = await getSession(sid);
  console.log("After card 2, log length:", s.state.public.log?.length ?? 0);
  console.log("Last log entry kind:", s.state.public.log?.[s.state.public.log.length - 1]?.kind);

  // Advance info i7.
  await dispatch(sid, "opening.info.i7.advance");
  s = await getSession(sid);
  console.log("After info i7 advance, log length:", s.state.public.log?.length ?? 0);

  console.log("\nFull log entries:");
  for (const entry of s.state.public.log) {
    console.log(`  - ${entry.actionId} (${entry.kind})`);
  }
})();
