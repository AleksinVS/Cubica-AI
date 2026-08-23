import { build } from "esbuild";

describe("browser-safe session validator exports", () => {
  it("bundles and executes the public validators without a Node filesystem dependency", async () => {
    const result = await build({
      stdin: {
        contents: `
          import {
            validatePrivateSessionInvitesShape,
            validateSessionVersionNotificationShape
          } from "@cubica/contracts-session";

          const validInvite = {
            seatId: "seat-browser",
            playerId: "actor-browser",
            credential: "ses_" + "a".repeat(43)
          };

          export const browserProbe = [
            validateSessionVersionNotificationShape({ stateVersion: 0, lastEventSequence: 0 }),
            validateSessionVersionNotificationShape({ stateVersion: -1, lastEventSequence: 0 }),
            validateSessionVersionNotificationShape({ stateVersion: 0, lastEventSequence: 0, state: {} }),
            validatePrivateSessionInvitesShape([validInvite]),
            validatePrivateSessionInvitesShape([{ ...validInvite, credential: "bad" }]),
            validatePrivateSessionInvitesShape([{ ...validInvite, extra: true }])
          ];
        `,
        resolveDir: process.cwd(),
        sourcefile: "session-validator-browser-entry.ts",
        loader: "ts"
      },
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      logLevel: "silent"
    });

    const code = result.outputFiles[0]?.text;
    expect(code).toBeDefined();
    expect(code).not.toContain("node:fs");

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(code!).toString("base64")}`;
    const bundledModule = await import(moduleUrl) as { browserProbe: boolean[] };
    expect(bundledModule.browserProbe).toEqual([true, false, false, true, false, false]);
  });
});
