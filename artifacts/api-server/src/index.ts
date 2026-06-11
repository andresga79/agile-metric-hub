import app from "./app";
import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { logger } from "./lib/logger";
import { ensureCacheTable } from "./lib/jira-cache";

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

    await ensureCacheTable();

    // Clean stale cache entries from periods other than 30d (portfolio now uses 30d)
    await db.execute(sql`DELETE FROM jira_cache WHERE cache_key ~ '^issues:[^:]+:(?:84|90|180)$'`);

    logger.info("Database tables ready");

    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`${usersTable.username} = 'admin'`)
      .limit(1);

    if (!existing) {
      const defaultPassword = process.env["DEFAULT_ADMIN_PASSWORD"] ?? "admin123";
      const passwordHash = await bcrypt.hash(defaultPassword, 10);
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
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });

  // Start background Jira cache sync after DB is ready
  import("./lib/jira-cache").then(({ startBackgroundSync }) => {
    startBackgroundSync();
  });
});
