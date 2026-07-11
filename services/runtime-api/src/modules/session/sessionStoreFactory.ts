/**
 * Runtime session-store configuration boundary.
 *
 * Production must explicitly select PostgreSQL and provide a connection URL.
 * The in-memory adapter is available only when a developer/test caller selects
 * it explicitly, preventing an accidental production start with volatile data.
 */

import { Pool, type PoolConfig } from "pg";
import type { SessionStorePort } from "@cubica/contracts-session";
import { InMemorySessionStore } from "./inMemorySessionStore.ts";
import { asSessionDatabasePool, PostgresSessionStore } from "./postgresSessionStore.ts";

type RuntimeState = Record<string, unknown>;

interface PoolErrorEmitter {
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface SessionStoreEnvironment {
  NODE_ENV?: string;
  SESSION_STORE?: string;
  DATABASE_URL?: string;
  PGPOOL_MAX?: string;
  PG_CONNECTION_TIMEOUT_MS?: string;
  PG_IDLE_TIMEOUT_MS?: string;
}

export function createSessionStoreFromEnvironment(
  environment: SessionStoreEnvironment = process.env
): SessionStorePort<RuntimeState> {
  const mode = environment.SESSION_STORE;
  if (mode === "in-memory") {
    if (environment.NODE_ENV === "production") {
      throw new Error("SESSION_STORE=in-memory is forbidden in production; configure PostgreSQL.");
    }
    return new InMemorySessionStore<RuntimeState>();
  }

  if (mode !== "postgresql") {
    throw new Error('SESSION_STORE must be explicitly set to "postgresql" or "in-memory".');
  }

  const connectionString = requiredNonEmpty(environment.DATABASE_URL, "DATABASE_URL");
  const poolConfig: PoolConfig = {
    connectionString,
    max: positiveInteger(environment.PGPOOL_MAX, "PGPOOL_MAX", 10),
    connectionTimeoutMillis: nonNegativeInteger(
      environment.PG_CONNECTION_TIMEOUT_MS,
      "PG_CONNECTION_TIMEOUT_MS",
      5_000
    ),
    idleTimeoutMillis: nonNegativeInteger(environment.PG_IDLE_TIMEOUT_MS, "PG_IDLE_TIMEOUT_MS", 30_000),
    application_name: "cubica-runtime-api"
  };

  const pool = new Pool(poolConfig);
  installSafePoolErrorHandler(pool);
  return new PostgresSessionStore<RuntimeState>(asSessionDatabasePool(pool));
}

/** Prevent an idle-client `error` event from crashing Node or leaking DB data. */
export function installSafePoolErrorHandler(
  pool: PoolErrorEmitter,
  log: (message: string) => void = (message) => console.error(message)
): void {
  pool.on("error", () => {
    // Never interpolate the driver error: it may contain host names, SQL text,
    // schema objects or other operational details unsuitable for user output.
    log("runtime-api PostgreSQL session pool lost an idle connection.");
  });
}

function requiredNonEmpty(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required when SESSION_STORE=postgresql.`);
  }
  return value;
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  const parsed = nonNegativeInteger(value, name, fallback);
  if (parsed === 0) {
    throw new Error(`${name} must be greater than zero.`);
  }
  return parsed;
}

function nonNegativeInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}
