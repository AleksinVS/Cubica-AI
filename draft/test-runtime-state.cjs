(async () => {
  const res = await fetch('http://localhost:3009/api/runtime/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'antarctica', playerId: 'player-web' })
  });
  const data = await res.json();
  console.log('Session:', data.sessionId);

  // Advance past intro
  const actionRes = await fetch('http://localhost:3009/api/runtime/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: data.sessionId, playerId: 'player-web', actionId: 'advanceIntro' })
  });
  const actionData = await actionRes.json();
  console.log('Action result:', JSON.stringify(actionData, null, 2));

  // Check runtime state
  const stateRes = await fetch(`http://localhost:3009/api/runtime/sessions/${data.sessionId}?playerId=player-web`);
  const stateData = await stateRes.json();
  console.log('State keys:', Object.keys(stateData));
  console.log('Current screen:', stateData.currentScreen);
  console.log('Has currentInfo:', !!stateData.currentInfo);
  console.log('Has currentBoard:', !!stateData.currentBoard);
  console.log('Has currentTeamSelection:', !!stateData.currentTeamSelection);
})();
