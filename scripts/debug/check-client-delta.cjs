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

(async () => {
  const sid = await createSession();

  // card 1
  let resp = await dispatch(sid, "opening.card.1");
  console.log("After card 1 dispatch, response.state.public.log length:", resp.state?.public?.log?.length ?? 0);

  // card 2
  resp = await dispatch(sid, "opening.card.2");
  console.log("After card 2 dispatch, response.state.public.log length:", resp.state?.public?.log?.length ?? 0);

  // Check if log entries have metricsBefore/metricsAfter
  const lastEntry = resp.state?.public?.log?.[resp.state?.public?.log?.length - 1];
  console.log("Last entry has metricsBefore:", !!lastEntry?.metricsBefore);
  console.log("Last entry has metricsAfter:", !!lastEntry?.metricsAfter);
  console.log("Last entry has metricDeltas:", !!lastEntry?.metricDeltas);
})();
