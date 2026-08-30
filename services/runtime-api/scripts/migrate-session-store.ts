/**
 * Apply ordered runtime-api session migrations with a durable migration ledger.
 *
 * Each invocation runs on one checked-out PostgreSQL client under an advisory
 * transaction lock. The checksum prevents a previously applied migration from
 * being edited silently, while `down` rolls back only the newest applied step.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
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
const migrationsDirectory = path.resolve(scriptDirectory, "../migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d{3}_[a-z0-9_]+\.up\.sql$/u.test(file))
  .sort();
const migrations = await Promise.all(migrationFiles.map(async (upFile) => {
  const version = upFile.slice(0, -".up.sql".length);
  const sql = await readFile(path.join(migrationsDirectory, upFile), "utf8");
  return {
    version,
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
    downFile: `${version}.down.sql`
  };
}));

const pool = new Pool({ connectionString: databaseUrl, application_name: "cubica-session-migration" });
installSafePoolErrorHandler(pool, (message) => console.error(message));
let client: PoolClient | undefined;
let transactionStarted = false;
let releaseError: Error | boolean | undefined;

try {
  client = await pool.connect();
  await client.query("BEGIN");
  transactionStarted = true;
  // A fixed advisory lock serializes migration runners without depending on a
  // table that may not exist yet in a fresh database.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('cubica-runtime-session-migrations'))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const appliedResult = await client.query<{ version: string; checksum_sha256: string }>(
    "SELECT version, checksum_sha256 FROM schema_migrations ORDER BY version"
  );
  const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum_sha256]));

  if (direction === "up") {
    for (const migration of migrations) {
      const priorChecksum = applied.get(migration.version);
      if (priorChecksum !== undefined) {
        if (priorChecksum !== migration.checksum) {
          throw new Error(`Applied migration ${migration.version} no longer matches its recorded checksum.`);
        }
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, checksum_sha256) VALUES ($1, $2)",
        [migration.version, migration.checksum]
      );
    }
  } else {
    const latestVersion = [...applied.keys()].sort().at(-1);
    if (latestVersion !== undefined) {
      const migration = migrations.find((candidate) => candidate.version === latestVersion);
      if (migration === undefined) {
        throw new Error(`Applied migration ${latestVersion} has no local rollback file.`);
      }
      const downSql = await readFile(path.join(migrationsDirectory, migration.downFile), "utf8");
      await client.query(downSql);
      await client.query("DELETE FROM schema_migrations WHERE version = $1", [latestVersion]);
    }
  }

  await client.query("COMMIT");
  // eslint-disable-next-line no-console
  console.log(`runtime-api session migrations ${direction} completed`);
} catch (error) {
  if (client !== undefined && transactionStarted) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
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
