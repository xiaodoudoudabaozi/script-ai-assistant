import { Pool } from "pg";

export const pool = new Pool({
  host: process.env.DATABASE_HOST ?? "localhost",
  port: parseInt(process.env.DATABASE_PORT ?? "5432"),
  user: process.env.DATABASE_USER ?? "postgres",
  password: process.env.DATABASE_PASSWORD ?? "postgres",
  database: process.env.DATABASE_NAME ?? "scriptstore",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[pg] Unexpected error on idle client", err);
});

export async function query(text: string, params?: any[]) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log("[pg] Executed query", { text: text.substring(0, 50), duration, rows: res.rowCount });
  return res;
}