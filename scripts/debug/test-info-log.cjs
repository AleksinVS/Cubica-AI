const { createDirectRuntimeSessionClient } = require("./runtime-command-client.cjs");

const runtimeUrl = "http://localhost:3001";

(async () => {
  const runtime = await createDirectRuntimeSessionClient(runtimeUrl, "antarctica");

  // Advance all info screens
  for (const id of ["i0", "i02", "i03", "i1", "i2", "i3", "i4", "i5", "i6"]) {
    await runtime.dispatch(`opening.info.${id}.advance`);
  }

  // card 1
  const data = await runtime.dispatch("opening.card.1");
  console.log("Card 1 dispatch log length:", data.state?.public?.log?.length);

  // get session
  const s = await runtime.getSession();
  console.log("Session store log length:", s.state?.public?.log?.length);
})();
