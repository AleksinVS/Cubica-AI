/** Apply or roll back the runtime-api session schema on a PostgreSQL database. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { installSafePoolErrorHandler } from "../src/modules/session/sessionStoreFactory.ts";

const direction = process.argv[2];
if (direction !== "up" && direction !== "down") {
  throw new Error('Usage: migrate-session-store.ts <up|down>');
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("DATABASE_URL is required to run session-store migrations.");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  scriptDirectory,
  "../migrations",
  `001_game_sessions.${direction}.sql`
);
const sql = await readFile(migrationPath, "utf8");
const pool = new Pool({ connectionString: databaseUrl, application_name: "cubica-session-migration" });
installSafePoolErrorHandler(pool, (message) => console.error(message));
let client: PoolClient | undefined;
let transactionStarted = false;
let releaseError: Error | boolean | undefined;

try {
  client = await pool.connect();
  // Keeping migration execution on one checked-out client makes the schema
  // change atomic just like a gameplay state transition.
  await client.query("BEGIN");
  transactionStarted = true;
  await client.query(sql);
  await client.query("COMMIT");
  // eslint-disable-next-line no-console
  console.log(`runtime-api session migration ${direction} completed`);
} catch (error) {
  if (client !== undefined && transactionStarted) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // A client that cannot roll back is not safe to return to the pool.
      releaseError = rollbackError instanceof Error ? rollbackError : true;
    }
  } else if (client !== undefined) {
    releaseError = error instanceof Error ? error : true;
  }
  throw error;
} finally {
  client?.release(releaseError);
  await pool.end();
}
