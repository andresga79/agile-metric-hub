import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;

async function seed() {
  const DATABASE_URL = process.env["DATABASE_URL"];
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    const { rows } = await client.query("SELECT COUNT(*) as count FROM users");
    if (Number(rows[0].count) === 0) {
      const defaultPassword = process.env["DEFAULT_ADMIN_PASSWORD"] || "admin123";
      const passwordHash = await bcrypt.hash(defaultPassword, 10);

      await client.query(
        "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)",
        ["admin", "admin@example.com", passwordHash]
      );
      console.log("Default admin user created (username: admin)");
    } else {
      console.log("Users already exist, skipping seed");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
