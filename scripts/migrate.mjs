import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.DATABASE_URL?.trim() ?? "";
const files = (await readdir("migrations").catch(() => []))
  .filter((file) => file.endsWith(".sql"))
  .sort();
if (url === "" || files.length === 0) {
  console.log("migrate: nothing to do");
  process.exit(0);
}
const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim() || url;
const ssl = sslOptions(connectionString);
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, ...(ssl ? { ssl } : {}) });
try {
  await client.connect();
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await client.query("select name from schema_migrations")).rows.map((row) => row.name));
  for (const file of files.filter((item) => !done.has(item))) {
    await client.query("begin");
    try {
      await client.query(await readFile(`migrations/${file}`, "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`migrate: applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} catch {
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

function sslOptions(connectionString) {
  const query = connectionString.split("?")[1] ?? "";
  let mode = "";
  for (const part of query.split("&")) {
    const [key, value = ""] = part.split("=");
    if (key === "sslmode") mode = decodeURIComponent(value);
  }
  if (mode === "require" || mode === "prefer" || mode === "verify-ca" || mode === "verify-full") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}
