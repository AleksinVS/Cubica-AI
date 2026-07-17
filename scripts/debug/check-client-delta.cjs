const { createDirectRuntimeSessionClient } = require("./runtime-command-client.cjs");

const runtimeUrl = "http://localhost:3001";

(async () => {
  const runtime = await createDirectRuntimeSessionClient(runtimeUrl, "antarctica");

  // card 1
  let resp = await runtime.dispatch("opening.card.1");
  console.log("After card 1 dispatch, response.state.public.log length:", resp.state?.public?.log?.length ?? 0);

  // card 2
  resp = await runtime.dispatch("opening.card.2");
  console.log("After card 2 dispatch, response.state.public.log length:", resp.state?.public?.log?.length ?? 0);

  // Check if log entries have metricsBefore/metricsAfter
  const lastEntry = resp.state?.public?.log?.[resp.state?.public?.log?.length - 1];
  console.log("Last entry has metricsBefore:", !!lastEntry?.metricsBefore);
  console.log("Last entry has metricsAfter:", !!lastEntry?.metricsAfter);
  console.log("Last entry has metricChanges:", !!lastEntry?.metricChanges);
})();
