import app from "./app";
import http from "http";
import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { logger } from "./lib/logger";
import { ensureCacheTable } from "./lib/jira-cache";
import { assertJwtConfig } from "./lib/jwt";
import { BCRYPT_ROUNDS } from "./lib/security";

// Fail fast at boot if the auth signing key is missing/weak (production), before
// the server ever accepts a request.
assertJwtConfig();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initDb() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Add role column if it doesn't exist (migration for existing DBs)
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS project_visibility (
        project_key TEXT PRIMARY KEY,
        visible BOOLEAN NOT NULL DEFAULT true,
        updated_by INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_project_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        visible BOOLEAN NOT NULL DEFAULT true,
        UNIQUE(user_id, project_id)
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS metric_targets (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        target_value NUMERIC NOT NULL,
        period TEXT NOT NULL DEFAULT '1m',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id SERIAL PRIMARY KEY,
        role TEXT NOT NULL,
        section TEXT NOT NULL,
        can_view BOOLEAN NOT NULL DEFAULT true,
        can_edit BOOLEAN NOT NULL DEFAULT false,
        UNIQUE(role, section)
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS default_metric_thresholds (
        id SERIAL PRIMARY KEY,
        metric TEXT NOT NULL UNIQUE,
        good_value NUMERIC NOT NULL,
        warning_value NUMERIC NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Migration: per-project threshold overrides (project_id NULL = global default).
    // The old UNIQUE(metric) constraint predates this and must be dropped, since a
    // project override needs a second row for the same metric.
    await db.execute(sql`
      ALTER TABLE default_metric_thresholds ADD COLUMN IF NOT EXISTS project_id TEXT;
    `);
    await db.execute(sql`
      ALTER TABLE default_metric_thresholds DROP CONSTRAINT IF EXISTS default_metric_thresholds_metric_key;
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS default_metric_thresholds_metric_project_idx
        ON default_metric_thresholds (metric, project_id);
    `);
    // Heal + prevent duplicate threshold rows. The seed (routes/admin/health.ts) did
    // read-then-insert with no atomicity and no unique constraint, so concurrent first-load
    // requests against a fresh DB each inserted the full default set — production ended up
    // with 3 copies of every metric. Dedup keeping the lowest id per (metric, project_id),
    // then enforce uniqueness. NULLS NOT DISTINCT (Postgres 15+) is required so the global
    // rows (project_id IS NULL) can't be duplicated — a plain unique index treats NULLs as
    // distinct. Both steps are idempotent: the DELETE is a no-op once clean, and the index
    // uses IF NOT EXISTS. Order matters — dedup must run before the unique index is created.
    await db.execute(sql`
      DELETE FROM default_metric_thresholds a
      USING default_metric_thresholds b
      WHERE a.metric = b.metric
        AND a.project_id IS NOT DISTINCT FROM b.project_id
        AND a.id > b.id;
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS default_metric_thresholds_metric_project_uq
        ON default_metric_thresholds (metric, project_id) NULLS NOT DISTINCT;
    `);

    await ensureCacheTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS metric_snapshots (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        week_start DATE NOT NULL,
        lead_time_avg NUMERIC,
        cycle_time_avg NUMERIC,
        throughput INTEGER NOT NULL DEFAULT 0,
        qa_rejection_rate NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(project_id, week_start)
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS portfolio_cache (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE,
        project_key TEXT NOT NULL,
        project_name TEXT NOT NULL,
        issue_count INTEGER NOT NULL DEFAULT 0,
        done_count INTEGER NOT NULL DEFAULT 0,
        in_progress_count INTEGER NOT NULL DEFAULT 0,
        throughput INTEGER NOT NULL DEFAULT 0,
        cycle_time_p50 NUMERIC,
        lead_time_avg NUMERIC,
        error TEXT,
        calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      ALTER TABLE portfolio_cache ADD COLUMN IF NOT EXISTS health_score INTEGER;
      ALTER TABLE portfolio_cache ADD COLUMN IF NOT EXISTS qa_rejection_rate NUMERIC;
      ALTER TABLE portfolio_cache ADD COLUMN IF NOT EXISTS throughput_previous INTEGER;
      ALTER TABLE portfolio_cache ADD COLUMN IF NOT EXISTS cycle_time_p50_previous NUMERIC;
      ALTER TABLE portfolio_cache ADD COLUMN IF NOT EXISTS lead_time_avg_previous NUMERIC;
      ALTER TABLE portfolio_cache ADD COLUMN IF NOT EXISTS health_score_previous INTEGER;
      ALTER TABLE portfolio_cache ADD COLUMN IF NOT EXISTS qa_rejection_rate_previous NUMERIC;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS portfolio_metric_settings (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE DEFAULT 'default',
        allowed_issue_types TEXT[] NOT NULL,
        updated_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      INSERT INTO portfolio_metric_settings (key, allowed_issue_types)
      VALUES ('default', ARRAY['Story', 'Task', 'Bug'])
      ON CONFLICT (key) DO NOTHING;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS blocked_reasons (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        issue_key TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Clean stale cache entries from periods other than 30d
    await db.execute(sql`DELETE FROM jira_cache WHERE cache_key ~ '^[a-z]+:[^:]+:(?:84|90|180)$'`);

    logger.info("Database tables ready");

    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`${usersTable.username} = 'admin'`)
      .limit(1);

    if (!existing) {
      const isProduction = process.env["NODE_ENV"] === "production";
      const configuredPassword = process.env["DEFAULT_ADMIN_PASSWORD"];
      // Never bootstrap the admin with a known/weak password in production. Local
      // dev keeps the convenience fallback (NODE_ENV is not "production").
      if (isProduction && (!configuredPassword || configuredPassword.length < 8 || configuredPassword === "admin123")) {
        throw new Error(
          "DEFAULT_ADMIN_PASSWORD must be set to a strong value (>=8 chars, not 'admin123') to bootstrap the admin user in production.",
        );
      }
      const defaultPassword = configuredPassword ?? "admin123";
      const passwordHash = await bcrypt.hash(defaultPassword, BCRYPT_ROUNDS);
      await db.insert(usersTable).values({
        username: "admin",
        email: "admin@example.com",
        passwordHash,
        role: "admin",
      });
      logger.info("Default admin user created");
    }

    // Ensure existing admin user has admin role
    await db.execute(sql`
      UPDATE users SET role = 'admin' WHERE username = 'admin' AND role != 'admin';
    `);
  } catch (err) {
    logger.error({ err }, "Failed to initialize database");
    throw err;
  }
}

initDb().then(() => {
  const server = http.createServer(app);
  server.requestTimeout = 0;
  server.timeout = 0;
  server.keepAliveTimeout = 120000;
  server.listen(port, "0.0.0.0", (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });

  // Start background Jira cache sync after DB is ready
  import("./lib/jira-cache").then(({ startBackgroundSync }) => {
    startBackgroundSync();
  }).catch((err) => {
    logger.error({ err }, "Failed to start background sync");
  });
});
