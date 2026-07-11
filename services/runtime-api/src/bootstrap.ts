import { createRuntimeApiServer } from "./modules/player-api/httpServer.ts";

async function bootstrap() {
  const runtimeApi = createRuntimeApiServer();
  await runtimeApi.start();

  let shutdownStarted = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    // Stop accepting requests, wait for active HTTP work, then drain the
    // PostgreSQL pool. This preserves in-flight transaction boundaries during
    // a normal process-manager restart.
    await runtimeApi.close();
    // eslint-disable-next-line no-console
    console.log(`runtime-api stopped after ${signal}`);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  // eslint-disable-next-line no-console
  console.log(`runtime-api listening on :${runtimeApi.port}`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to bootstrap runtime-api", error);
  process.exitCode = 1;
});
