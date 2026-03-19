import { createRuntimeApiServer } from "./modules/player-api/httpServer.ts";

async function bootstrap() {
  const runtimeApi = createRuntimeApiServer();
  await runtimeApi.start();

  // eslint-disable-next-line no-console
  console.log(`runtime-api listening on :${runtimeApi.port}`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to bootstrap runtime-api", error);
  process.exitCode = 1;
});
