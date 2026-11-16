import { spawn } from "node:child_process";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { accountAnswers } from "../src/data/questions.ts";
import { passwordOk } from "./passwordPolicy.ts";
import { customers, latestFromLanes } from "../src/data/portfolio.ts";

const scrypt = promisify(scryptCb);
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

let pool: pg.Pool | undefined;
let local: Promise<PGlite> | undefined;
let seeded: Promise<void> | undefined;
let localMode = false;

function postgres(): boolean {
  return databaseUrl !== "" && !localMode;
}

export function storesInPostgres(): boolean {
  return postgres();
}

export async function reconnectDatabase(): Promise<boolean> {
  await ready();
  if (databaseUrl === "") return false;
  if (!localMode) return true;
  try {
    await poolQuery("select 1 as ok");
    localMode = false;
    return true;
  } catch {
    return false;
  }
}

function sslOptions(connectionString: string): { rejectUnauthorized: false } | undefined {
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

function pgOptions(connectionString: string): pg.PoolConfig {
  const options: pg.PoolConfig = { connectionString, max: 5, connectionTimeoutMillis: 5000 };
  const ssl = sslOptions(connectionString);
  if (ssl) options.ssl = ssl;
  return options;
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  if (postgres()) {
    pool ??= new pg.Pool(pgOptions(databaseUrl));
    return (await pool.query(text, params)).rows as T[];
  }
  return (await (await localDb()).query<T>(text, params)).rows;
}

async function ready(): Promise<void> {
  seeded ??= (async () => {
    if (databaseUrl !== "") {
      try {
        await runMigrate();
      } catch {
        console.error("migrate: skipped");
      }
      try {
        await poolQuery("select 1 as ok");
      } catch {
        localMode = true;
        console.error("database: local");
      }
    } else {
      localMode = true;
    }
    if (localMode) await localDb();
    await ensureSeed();
    await syncAdminPassword();
    await renameAdminLabel();
  })().catch((error: unknown) => {
    seeded = undefined;
    throw error;
  });
  await seeded;
}

export async function whenReady(): Promise<void> {
  await ready();
}

function runMigrate(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migrate.mjs"], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`migrate exited ${code ?? "null"}`));
    });
  });
}

async function localDb(): Promise<PGlite> {
  local ??= startLocal().catch((error: unknown) => {
    local = undefined;
    throw error;
  });
  return local;
}

async function startLocal(): Promise<PGlite> {
  const db = new PGlite();
  const files = (await readdir("migrations").catch(() => [])).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  return db;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

export async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [kind, salt, hex] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hex) return false;
  const hash = (await scrypt(password, salt, 32)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

async function ensureSeed(): Promise<void> {
  const insert = postgres() ? poolQuery : async (text: string, params: unknown[] = []) => (await (await localDb()).query(text, params)).rows;
  try {
    for (const company of customers) {
      await insert(
        `insert into companies (id, name, industry, place) values ($1, $2, $3, $4)
         on conflict (id) do nothing`,
        [company.id, company.name, company.industry, company.place],
      );
    }
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const existing = postgres()
    ? ((await poolQuery("select id from users limit 1")) as { id: string }[])
    : (await (await localDb()).query<{ id: string }>("select id from users limit 1")).rows;
  if (existing.length > 0) return;

  const people: { username: string; name: string; role: "admin" | "customer"; companyId: string | null; seat: string | null }[] = [
    { username: "admin", name: "Freightlytics-admin", role: "admin", companyId: null, seat: null },
    { username: "nordhavn", name: "Nordhavn Living", role: "customer", companyId: "nordhavn-living", seat: "Owner" },
    { username: "nordhavn-kollega", name: "Maja Holm", role: "customer", companyId: "nordhavn-living", seat: "Operations" },
    { username: "vesterbro", name: "Vesterbro Cloth", role: "customer", companyId: "vesterbro-cloth", seat: "Owner" },
    { username: "kolding", name: "Kolding Table Co.", role: "customer", companyId: "kolding-table-co", seat: "Owner" },
    { username: "horsens", name: "Horsens Gearworks", role: "customer", companyId: "horsens-gearworks", seat: "Owner" },
    { username: "skive", name: "Skive Plate Works", role: "customer", companyId: "skive-plate-works", seat: "Owner" },
    { username: "esbjerg", name: "Esbjerg Rig Supply", role: "customer", companyId: "esbjerg-rig-supply", seat: "Owner" },
  ];
  const ids = new Map<string, string>();
  for (const person of people) {
    const id = crypto.randomUUID();
    ids.set(person.username, id);
    await insert(
      `insert into users (id, username, name, role, company_id, lang, sample, seat)
       values ($1, $2, $3, $4, $5, 'da', 1, $6)`,
      [id, person.username, person.name, person.role, person.companyId, person.seat],
    );
  }

  const nordhavn = customers.find((company) => company.id === "nordhavn-living");
  if (!nordhavn) return;
  try {
    await insert(
      `insert into bills (id, company_id, label, amount, source, carrier)
       values ($1, $2, $3, $4, 'manual', $5)`,
      [crypto.randomUUID(), nordhavn.id, "Tillægsfaktura", 12400, "GLS"],
    );
    const latest = latestFromLanes(nordhavn);
    const answers = accountAnswers(nordhavn);
    const summary = {
      month: "oktober 2026",
      paid: latest.paid,
      benchmark: latest.benchmark,
      savings: latest.savings,
      lines: answers.agreementLines.map((line) => ({
        carrier: line.carrier,
        route: line.route,
        difference: line.difference,
      })),
    };
    await insert(
      `insert into reports (id, company_id, name, summary)
       values ($1, $2, $3, $4)`,
      [crypto.randomUUID(), nordhavn.id, "Oktober 2026 · aftaletjek", JSON.stringify(summary)],
    );

    const packId = crypto.randomUUID();
    await insert(
      `insert into tender_packs (id, company_id, title, created_by)
       values ($1, $2, $3, $4)`,
      [packId, nordhavn.id, "Udbud · Nordhavn Living", ids.get("nordhavn") ?? null],
    );
    for (const lane of nordhavn.lanes) {
      await insert(
        `insert into tender_lines (id, pack_id, origin, destination, service, carrier, shipments)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [crypto.randomUUID(), packId, lane.origin, lane.destination, lane.service, lane.carrier, lane.shipments],
      );
    }
    const colleague = ids.get("nordhavn-kollega");
    if (colleague) {
      await insert(
        "insert into tender_comments (id, pack_id, user_id, body) values ($1, $2, $3, $4)",
        [crypto.randomUUID(), packId, colleague, "Kan vi udelade ø-levering?"],
      );
    }
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
}

function missingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "42P01";
}

export async function syncAdminPassword(explicit?: string): Promise<void> {
  const password = (explicit ?? process.env.FRAGTBLIK_ADMIN_PASSWORD ?? "").trim();
  if (!passwordOk(password)) return;
  const existing = await directQuery<{ password_hash: string | null }>(
    "select password_hash from users where username = 'admin' order by created_at limit 1",
  );
  if (existing[0] && (await checkPassword(password, existing[0].password_hash))) return;
  const hash = await hashPassword(password);
  const updated = await directQuery<{ id: string }>(
    "update users set password_hash = $1, role = 'admin' where username = 'admin' returning id",
    [hash],
  );
  if (updated.length > 0) return;
  await directQuery(
    `insert into users (id, username, name, role, lang, sample, password_hash)
     values ($1, 'admin', 'Freightlytics-admin', 'admin', 'da', 1, $2)`,
    [crypto.randomUUID(), hash],
  );
}

async function directQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (postgres()) return (await poolQuery(text, params)) as T[];
  return (await (await localDb()).query<T>(text, params)).rows;
}

async function renameAdminLabel(): Promise<void> {
  const query = postgres()
    ? poolQuery
    : async (text: string, params: unknown[] = []) => (await (await localDb()).query(text, params)).rows;
  await query("update users set name = $1 where username = 'admin' and name = 'Fragtblik-admin'", ["Freightlytics-admin"]);
}

async function poolQuery(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  pool ??= new pg.Pool(pgOptions(databaseUrl));
  return (await pool.query(text, params)).rows as Record<string, unknown>[];
}
