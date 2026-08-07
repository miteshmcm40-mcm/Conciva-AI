import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// No PG_HOST in .env → local dev with no Postgres server available. Fall back
// to PGlite (real Postgres compiled to WASM, running in-process and
// persisting to a local directory) instead of a real `pg` connection. This
// keeps every query in the rest of server/*.js — $N placeholders, JSONB,
// ON CONFLICT, plpgsql triggers — working unmodified, since it IS Postgres,
// just embedded rather than a separate server process.
let pool;

if (process.env.PG_HOST) {
  const { default: pg } = await import('pg');
  const { Pool } = pg;

  pool = new Pool({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    database: process.env.PG_DB,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    max: 10,
    idleTimeoutMillis: 30000,
    // Without this, a firewall that silently drops packets (instead of
    // rejecting the connection) leaves the query hanging until the *platform's*
    // request timeout kills it — on Vercel that surfaces as a raw 503 instead
    // of the app's own "Database unavailable" JSON error. Failing fast here
    // lets the route handler's try/catch respond properly instead.
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('[pg] idle client error', err);
  });
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = process.env.PGLITE_DATA_DIR || path.join(__dirname, '..', '.data', 'pglite');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;

  console.log(`[db] PG_HOST unset — using embedded Postgres (PGlite) at ${dataDir}. Set PG_HOST/PG_PORT/PG_DB/PG_USER/PG_PASSWORD in .env to use a real Postgres server instead.`);

  // In real deployments, server/schema.sql is applied by hand before the app
  // ever boots — server/index.js's runMigrations() only layers incremental
  // ALTERs on top of it (see the comment there). PGlite starts from a truly
  // empty database, so apply the base schema ourselves; every statement in
  // it is CREATE TABLE/INDEX IF NOT EXISTS, so this is a no-op on later boots.
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.exec(schemaSql);

  // Minimal shape-compatible stand-in for a `pg` Pool: .query/.end, plus a
  // no-op .on so the pool.on('error', ...) wiring above is unnecessary here
  // (PGlite runs in-process — there's no idle-client-drop failure mode).
  //
  // PGlite's result only has {rows, affectedRows, fields} — no `rowCount`.
  // The rest of server/*.js is written against node-postgres, which always
  // returns rowCount === rows.length for the plain SELECT/INSERT/UPDATE/
  // DELETE-with-or-without-RETURNING patterns used here, so add it back.
  pool = {
    query: async (text, params) => {
      const result = await db.query(text, params);
      // affectedRows is 0 (not undefined) on a plain SELECT, so it can't be
      // trusted with `??` — prefer rows.length whenever rows came back (SELECT,
      // or DML with RETURNING), and only fall back to affectedRows for DML
      // that returned no rows (UPDATE/DELETE/INSERT without RETURNING).
      const rowCount = result.rows.length > 0 ? result.rows.length : (result.affectedRows || 0);
      return { ...result, rowCount };
    },
    end: () => db.close(),
    on: () => {},
  };
}

export { pool };
export const q = (text, params) => pool.query(text, params);
