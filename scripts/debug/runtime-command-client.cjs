/**
 * Authenticated runtime command helpers for local debug scripts.
 *
 * Direct runtime calls keep the one-time Bearer credential only in this
 * process. Browser-facing checks execute BFF requests inside the Playwright
 * page, so the browser stores and returns the HttpOnly credential cookie while
 * the script itself never needs to read that cookie.
 */

const { randomBytes } = require("node:crypto");

/** A fresh id identifies one logical command and is never reused accidentally. */
function createCommandId() {
  return `cli_${randomBytes(16).toString("base64url")}`;
}

function readStateVersion(snapshot, label) {
  const stateVersion = snapshot?.version?.stateVersion;
  if (!Number.isInteger(stateVersion) || stateVersion < 0) {
    throw new Error(`${label} did not return version.stateVersion.`);
  }
  return stateVersion;
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  let data;
  try {
    data = text === "" ? {} : JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON (${response.status}).`);
  }

  if (!response.ok) {
    const detail = typeof data?.error === "string" ? `: ${data.error}` : "";
    throw new Error(`${label} failed (${response.status})${detail}`);
  }
  if (data?.receipt?.status === "rejected") {
    throw new Error(`${label} was rejected: ${data.receipt.rejectionCode ?? "unknown reason"}`);
  }
  return data;
}

/**
 * Creates a stateful client for scripts that talk to runtime-api directly.
 * The client advances its optimistic-concurrency version after every response.
 */
async function createDirectRuntimeSessionClient(runtimeUrl, gameId) {
  const snapshot = await readJsonResponse(await fetch(`${runtimeUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId })
  }), "Create runtime session");

  if (typeof snapshot.sessionId !== "string" || typeof snapshot.credential !== "string") {
    throw new Error("Create runtime session did not return sessionId and credential.");
  }

  let expectedStateVersion = readStateVersion(snapshot, "Create runtime session");
  const authorization = `Bearer ${snapshot.credential}`;
  const safeSnapshot = { ...snapshot };
  delete safeSnapshot.credential;

  return {
    sessionId: snapshot.sessionId,
    snapshot: safeSnapshot,

    async dispatch(actionId, params = {}) {
      const next = await readJsonResponse(await fetch(`${runtimeUrl}/actions`, {
        method: "POST",
        headers: {
          "Authorization": authorization,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId: snapshot.sessionId,
          actionId,
          commandId: createCommandId(),
          expectedStateVersion,
          params
        })
      }), `Action ${actionId}`);
      expectedStateVersion = readStateVersion(next, `Action ${actionId}`);
      return next;
    },

    async getSession() {
      const next = await readJsonResponse(await fetch(
        `${runtimeUrl}/sessions/${encodeURIComponent(snapshot.sessionId)}`,
        { headers: { "Authorization": authorization } }
      ), "Read runtime session");
      expectedStateVersion = readStateVersion(next, "Read runtime session");
      return next;
    }
  };
}

/**
 * Creates a stateful client inside a Playwright page for player-web BFF checks.
 * The page must already be on the player-web origin before this is called.
 */
async function createBrowserBffSessionClient(page, gameId) {
  const snapshot = await page.evaluate(async (requestedGameId) => {
    const response = await fetch("/api/runtime/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ gameId: requestedGameId })
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Create BFF session failed (${response.status}): ${text}`);
    }
    return JSON.parse(text);
  }, gameId);

  if (typeof snapshot?.sessionId !== "string") {
    throw new Error("Create BFF session did not return sessionId.");
  }

  let expectedStateVersion = readStateVersion(snapshot, "Create BFF session");

  return {
    sessionId: snapshot.sessionId,
    snapshot,

    async dispatch(actionId, params = {}) {
      const envelope = {
        sessionId: snapshot.sessionId,
        actionId,
        commandId: createCommandId(),
        expectedStateVersion,
        params
      };
      const next = await page.evaluate(async (command) => {
        const response = await fetch("/api/runtime/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(command)
        });
        const text = await response.text();
        if (!response.ok) {
          throw new Error(`BFF action failed (${response.status}): ${text}`);
        }
        const data = JSON.parse(text);
        if (data?.receipt?.status === "rejected") {
          throw new Error(`BFF action was rejected: ${data.receipt.rejectionCode ?? "unknown reason"}`);
        }
        return data;
      }, envelope);
      expectedStateVersion = readStateVersion(next, `BFF action ${actionId}`);
      return next;
    }
  };
}

module.exports = {
  createBrowserBffSessionClient,
  createDirectRuntimeSessionClient
};
