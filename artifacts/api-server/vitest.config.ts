import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The module under test transitively imports @workspace/db, which throws at
    // import time if DATABASE_URL is unset. These are pure-function unit tests
    // that never touch the DB (node-postgres' Pool connects lazily), so a dummy
    // connection string is enough to let the import succeed — it is never used.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    },
  },
});
