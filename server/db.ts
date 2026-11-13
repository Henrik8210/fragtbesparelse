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

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  if (databaseUrl !== "") {
    pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    return (await pool.query(text, params)).rows as T[];
  }
  return (await (await localDb()).query<T>(text, params)).rows;
}

async function ready(): Promise<void> {
  if (databaseUrl === "") await localDb();
  seeded ??= (async () => {
    await ensurePilotOrgs();
    await ensureSeed();
    await ensureAdminPassword();
    await renameAdminLabel();
  })().catch((error: unknown) => {
    seeded = undefined;
    throw error;
  });
  await seeded;
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
  const existing = databaseUrl
    ? ((await poolQuery("select id from users limit 1")) as { id: string }[])
    : (await (await localDb()).query<{ id: string }>("select id from users limit 1")).rows;
  if (existing.length > 0) return;
  const insert = databaseUrl ? poolQuery : async (text: string, params: unknown[] = []) => (await (await localDb()).query(text, params)).rows;

  for (const company of customers) {
    await insert("insert into companies (id, name, industry, place) values ($1, $2, $3, $4)", [
      company.id,
      company.name,
      company.industry,
      company.place,
    ]);
  }

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
}

async function ensurePilotOrgs(): Promise<void> {
  const query = databaseUrl
    ? poolQuery
    : async (text: string, params: unknown[] = []) => (await (await localDb()).query(text, params)).rows;
  await query(
    `create table if not exists pilot_orgs (
      id text primary key,
      name text not null,
      carrier text not null,
      invoice text not null,
      rates text not null,
      created_at timestamptz not null default now()
    )`,
  );
}

async function ensureAdminPassword(): Promise<void> {
  const password = (process.env.FRAGTBLIK_ADMIN_PASSWORD ?? "").trim();
  if (!passwordOk(password)) return;
  const query = databaseUrl
    ? poolQuery
    : async (text: string, params: unknown[] = []) => (await (await localDb()).query(text, params)).rows;
  const rows = (await query("select id from users where role = 'admin' and username = 'admin'")) as { id: string }[];
  if (!rows[0]) return;
  await query("update users set password_hash = $1 where role = 'admin' and username = 'admin'", [await hashPassword(password)]);
}

async function renameAdminLabel(): Promise<void> {
  const query = databaseUrl
    ? poolQuery
    : async (text: string, params: unknown[] = []) => (await (await localDb()).query(text, params)).rows;
  await query("update users set name = $1 where username = 'admin' and name = 'Fragtblik-admin'", ["Freightlytics-admin"]);
}

async function poolQuery(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
  return (await pool.query(text, params)).rows as Record<string, unknown>[];
}
