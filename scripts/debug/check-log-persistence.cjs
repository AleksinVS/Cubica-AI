const { createDirectRuntimeSessionClient } = require("./runtime-command-client.cjs");

const runtimeUrl = "http://localhost:3001";

(async () => {
  const runtime = await createDirectRuntimeSessionClient(runtimeUrl, "antarctica");
  console.log("Session created:", runtime.sessionId);

  // Advance info screens
  for (const id of ["i0", "i02", "i03", "i1", "i2", "i3", "i4", "i5", "i6"]) {
    await runtime.dispatch(`opening.info.${id}.advance`);
  }

  let s = await runtime.getSession();
  console.log("After info advances, log length:", s.state.public.log?.length ?? 0);

  // Select card 1
  await runtime.dispatch("opening.card.1");
  s = await runtime.getSession();
  console.log("After card 1, log length:", s.state.public.log?.length ?? 0);
  console.log("Last log entry kind:", s.state.public.log?.[s.state.public.log.length - 1]?.kind);

  // Select card 2
  await runtime.dispatch("opening.card.2");
  s = await runtime.getSession();
  console.log("After card 2, log length:", s.state.public.log?.length ?? 0);
  console.log("Last log entry kind:", s.state.public.log?.[s.state.public.log.length - 1]?.kind);

  // Advance info i7.
  await runtime.dispatch("opening.info.i7.advance");
  s = await runtime.getSession();
  console.log("After info i7 advance, log length:", s.state.public.log?.length ?? 0);

  console.log("\nFull log entries:");
  for (const entry of s.state.public.log) {
    console.log(`  - ${entry.actionId} (${entry.kind})`);
  }
})();
