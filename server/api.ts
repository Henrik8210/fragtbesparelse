import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { knownCarrier } from "../src/data/carriers.ts";
import { customers } from "../src/data/portfolio.ts";
import { requestMayClaimAdmin } from "./appOwner.ts";
import { checkPassword, hashPassword, sql } from "./db.ts";

const SEATS = ["Owner", "Billing", "Operations"] as const;

type UserRow = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "customer";
  company_id: string | null;
  password_hash: string | null;
  lang: string;
  sample: number;
  seat: string | null;
};

export type PublicUser = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "customer";
  customerId: string | null;
  lang: "da" | "en";
  sample: boolean;
  seat: string | null;
  hasPassword: boolean;
};

function publish(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    customerId: row.company_id,
    lang: row.lang === "en" ? "en" : "da",
    sample: Number(row.sample) === 1,
    seat: row.seat,
    hasPassword: Boolean(row.password_hash),
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}

function cookieToken(req: IncomingMessage): string | null {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "fragtblik") return decodeURIComponent(rest.join("="));
  }
  return null;
}

function setSessionCookie(res: ServerResponse, token: string | null) {
  const value = token
    ? `fragtblik=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600`
    : "fragtblik=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
  res.setHeader("Set-Cookie", value);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("too-big");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let cleaned = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    cleaned += code < 32 || code === 127 ? " " : char;
  }
  return cleaned.replace(/\s+/g, " ").trim().slice(0, max);
}

function companyOk(id: string): boolean {
  return customers.some((company) => company.id === id);
}

function canSee(user: UserRow, companyId: string): boolean {
  return user.role === "admin" || user.company_id === companyId;
}

async function actor(req: IncomingMessage): Promise<UserRow | null> {
  const token = cookieToken(req);
  if (!token) return null;
  const rows = await sql<UserRow>(
    `select users.* from sessions join users on users.id = sessions.user_id where sessions.token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method ?? "GET";
  try {
    if (method === "GET" && path === "/api/sign-in-state") {
      const rows = await sql<{ ready: number }>(
        "select count(*)::int as ready from users where role = 'admin' and password_hash is not null",
      );
      const needsAdminPassword = Number(rows[0]?.ready ?? 0) === 0;
      send(res, 200, {
        needsAdminPassword,
        canChooseAdminPassword: needsAdminPassword && (await requestMayClaimAdmin(req)),
      });
      return;
    }

    if (method === "POST" && path === "/api/admin-password") {
      const body = (await readJson(req)) as { password?: unknown; current?: unknown };
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 4 || password.length > 80) {
        send(res, 400, { error: "password" });
        return;
      }
      const rows = await sql<UserRow>("select * from users where role = 'admin' and username = 'admin'");
      const admin = rows[0];
      if (!admin) {
        send(res, 404, { error: "missing" });
        return;
      }
      if (!admin.password_hash) {
        if (!(await requestMayClaimAdmin(req))) {
          send(res, 403, { error: "forbidden" });
          return;
        }
        const updated = await sql<{ id: string }>(
          `update users set password_hash = $1
           where id = $2 and password_hash is null
           returning id`,
          [await hashPassword(password), admin.id],
        );
        if (updated.length === 0) {
          send(res, 409, { error: "taken" });
          return;
        }
        send(res, 200, { ok: true });
        return;
      }
      const caller = await actor(req);
      if (!caller || caller.id !== admin.id) {
        send(res, caller ? 403 : 401, { error: caller ? "forbidden" : "sign-in" });
        return;
      }
      const current = typeof body.current === "string" ? body.current : "";
      if (!(await checkPassword(current, admin.password_hash))) {
        send(res, 401, { error: "login" });
        return;
      }
      await sql("update users set password_hash = $1 where id = $2", [await hashPassword(password), admin.id]);
      const token = cookieToken(req);
      await sql("delete from sessions where user_id = $1 and token <> $2", [admin.id, token]);
      send(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && path === "/api/login") {
      const body = (await readJson(req)) as { username?: unknown; password?: unknown };
      const username = text(body.username, 40).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      const rows = await sql<UserRow>("select * from users where username = $1", [username]);
      const user = rows[0];
      if (!user?.password_hash || !(await checkPassword(password, user.password_hash))) {
        send(res, 401, { error: "login" });
        return;
      }
      const token = randomBytes(32).toString("hex");
      await sql("insert into sessions (token, user_id) values ($1, $2)", [token, user.id]);
      setSessionCookie(res, token);
      send(res, 200, { user: publish(user) });
      return;
    }

    if (method === "POST" && path === "/api/logout") {
      const token = cookieToken(req);
      if (token) await sql("delete from sessions where token = $1", [token]);
      setSessionCookie(res, null);
      send(res, 200, { ok: true });
      return;
    }

    const user = await actor(req);
    if (!user) {
      send(res, 401, { error: "sign-in" });
      return;
    }

    if (method === "GET" && path === "/api/me") {
      send(res, 200, { user: publish(user) });
      return;
    }

    if (method === "PATCH" && path === "/api/me") {
      const body = (await readJson(req)) as { lang?: unknown };
      const lang = body.lang === "en" ? "en" : body.lang === "da" ? "da" : null;
      if (!lang) {
        send(res, 400, { error: "lang" });
        return;
      }
      await sql("update users set lang = $1 where id = $2", [lang, user.id]);
      send(res, 200, { user: { ...publish(user), lang } });
      return;
    }

    if (method === "GET" && path === "/api/bills") {
      const rows = user.role === "admin"
        ? await sql("select * from bills order by created_at")
        : await sql("select * from bills where company_id = $1 order by created_at", [user.company_id]);
      send(res, 200, { bills: rows.map(billJson) });
      return;
    }

    const billCompany = path.match(/^\/api\/companies\/([^/]+)\/bills$/);
    if (billCompany && method === "POST") {
      const companyId = decodeURIComponent(billCompany[1]);
      if (!canSee(user, companyId)) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const body = (await readJson(req)) as Record<string, unknown>;
      const amount = Math.round(Number(body.amount));
      const carrier = text(body.carrier, 80);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000 || !knownCarrier(carrier)) {
        send(res, 400, { error: "bill" });
        return;
      }
      const source = body.source === "file" ? "file" : "manual";
      const label = text(body.label, 120) || (user.lang === "en" ? "Freight bill" : "Fragtregning");
      const id = crypto.randomUUID();
      const rows = await sql(
        `insert into bills (id, company_id, label, amount, source, carrier, created_by)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [id, companyId, label, amount, source, carrier, user.id],
      );
      send(res, 201, { bill: billJson(rows[0]) });
      return;
    }

    const billId = path.match(/^\/api\/bills\/([^/]+)$/);
    if (billId && method === "DELETE") {
      const rows = await sql<{ company_id: string }>("select company_id from bills where id = $1", [decodeURIComponent(billId[1])]);
      const bill = rows[0];
      if (!bill || !canSee(user, bill.company_id)) {
        send(res, 404, { error: "missing" });
        return;
      }
      await sql("delete from bills where id = $1", [decodeURIComponent(billId[1])]);
      send(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && path === "/api/users") {
      const rows = user.role === "admin"
        ? await sql<UserRow>("select * from users order by name")
        : await sql<UserRow>("select * from users where company_id = $1 order by name", [user.company_id]);
      send(res, 200, { users: rows.map(publish) });
      return;
    }

    if (method === "POST" && path === "/api/users") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const name = text(body.name, 80);
      const username = text(body.username, 40).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      const kind = body.kind === "admin" ? "admin" : "customer";
      const seat = SEATS.find((item) => item === body.seat) ?? null;
      const companyId = text(body.companyId, 80);
      if (!name) {
        send(res, 400, { error: "name" });
        return;
      }
      if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(username)) {
        send(res, 400, { error: "username" });
        return;
      }
      const settingPassword = user.role === "admin";
      if (settingPassword && (password.length < 4 || password.length > 80)) {
        send(res, 400, { error: "password" });
        return;
      }
      const passwordHash = settingPassword ? await hashPassword(password) : null;
      if (kind === "admin") {
        if (user.role !== "admin") {
          send(res, 403, { error: "forbidden" });
          return;
        }
      } else {
        const target = user.role === "admin" ? companyId : (user.company_id ?? "");
        if (!companyOk(target) || !seat || (user.role === "customer" && target !== user.company_id)) {
          send(res, 400, { error: "customer" });
          return;
        }
        const taken = await sql("select id from users where username = $1", [username]);
        if (taken.length > 0) {
          send(res, 409, { error: "taken" });
          return;
        }
        const created = await sql<UserRow>(
          `insert into users (id, username, name, role, company_id, password_hash, seat)
           values ($1, $2, $3, 'customer', $4, $5, $6) returning *`,
          [crypto.randomUUID(), username, name, target, passwordHash, seat],
        );
        send(res, 201, { user: publish(created[0]) });
        return;
      }
      const taken = await sql("select id from users where username = $1", [username]);
      if (taken.length > 0) {
        send(res, 409, { error: "taken" });
        return;
      }
      const created = await sql<UserRow>(
        `insert into users (id, username, name, role, password_hash)
         values ($1, $2, $3, 'admin', $4) returning *`,
        [crypto.randomUUID(), username, name, passwordHash],
      );
      send(res, 201, { user: publish(created[0]) });
      return;
    }

    const setPassword = path.match(/^\/api\/users\/([^/]+)\/password$/);
    if (setPassword && method === "POST") {
      if (user.role !== "admin") {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const body = (await readJson(req)) as { password?: unknown };
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 4 || password.length > 80) {
        send(res, 400, { error: "password" });
        return;
      }
      const targetId = decodeURIComponent(setPassword[1]);
      const existing = await sql<UserRow>("select * from users where id = $1", [targetId]);
      if (existing[0]?.role === "admin" && existing[0].username === "admin") {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const rows = await sql<UserRow>(
        "update users set password_hash = $1 where id = $2 returning *",
        [await hashPassword(password), targetId],
      );
      const target = rows[0];
      if (!target) {
        send(res, 404, { error: "missing" });
        return;
      }
      send(res, 200, { user: publish(target) });
      return;
    }

    const userId = path.match(/^\/api\/users\/([^/]+)$/);
    if (userId && method === "DELETE") {
      const rows = await sql<UserRow>("select * from users where id = $1", [decodeURIComponent(userId[1])]);
      const target = rows[0];
      if (!target || Number(target.sample) === 1) {
        send(res, 404, { error: "missing" });
        return;
      }
      if (user.role !== "admin" && target.company_id !== user.company_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      await sql("delete from users where id = $1", [target.id]);
      send(res, 200, { ok: true });
      return;
    }

    const reviews = path.match(/^\/api\/companies\/([^/]+)\/reviews$/);
    if (reviews && method === "GET") {
      const companyId = decodeURIComponent(reviews[1]);
      if (!canSee(user, companyId)) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const rows = await sql<{ line_key: string; state: string }>("select line_key, state from reviews where company_id = $1", [companyId]);
      const map: Record<string, string> = {};
      for (const row of rows) map[row.line_key] = row.state;
      send(res, 200, { reviews: map });
      return;
    }
    if (reviews && method === "PUT") {
      const companyId = decodeURIComponent(reviews[1]);
      if (!canSee(user, companyId)) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const body = (await readJson(req)) as { key?: unknown; state?: unknown };
      const key = text(body.key, 160);
      const state = body.state === "accepted" ? "accepted" : body.state === "open" ? "open" : "";
      if (!key || !state) {
        send(res, 400, { error: "review" });
        return;
      }
      await sql(
        `insert into reviews (company_id, line_key, state) values ($1, $2, $3)
         on conflict (company_id, line_key) do update set state = excluded.state`,
        [companyId, key, state],
      );
      send(res, 200, { ok: true });
      return;
    }

    const reports = path.match(/^\/api\/companies\/([^/]+)\/reports$/);
    if (reports && method === "GET") {
      const companyId = decodeURIComponent(reports[1]);
      if (!canSee(user, companyId)) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const rows = await sql("select id, name, summary, created_at from reports where company_id = $1 order by created_at desc", [companyId]);
      send(res, 200, { reports: rows.map(reportJson) });
      return;
    }
    if (reports && method === "POST") {
      const companyId = decodeURIComponent(reports[1]);
      if (!canSee(user, companyId)) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const body = (await readJson(req)) as { name?: unknown; summary?: unknown };
      const name = text(body.name, 120) || "Fakturatjek";
      if (!body.summary || typeof body.summary !== "object") {
        send(res, 400, { error: "report" });
        return;
      }
      const summary = JSON.stringify(body.summary).slice(0, 20000);
      const rows = await sql(
        `insert into reports (id, company_id, name, summary, created_by) values ($1, $2, $3, $4, $5)
         returning id, name, summary, created_at`,
        [crypto.randomUUID(), companyId, name, summary, user.id],
      );
      send(res, 201, { report: reportJson(rows[0]) });
      return;
    }

    const tenders = path.match(/^\/api\/companies\/([^/]+)\/tenders$/);
    if (tenders && method === "GET") {
      const companyId = decodeURIComponent(tenders[1]);
      if (!canSee(user, companyId)) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      send(res, 200, { tenders: await tenderList(companyId) });
      return;
    }
    if (tenders && method === "POST") {
      const companyId = decodeURIComponent(tenders[1]);
      if (!canSee(user, companyId)) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const company = customers.find((item) => item.id === companyId);
      if (!company) {
        send(res, 404, { error: "missing" });
        return;
      }
      const id = crypto.randomUUID();
      await sql(
        `insert into tender_packs (id, company_id, title, created_by) values ($1, $2, $3, $4)`,
        [id, companyId, `${company.name} · udbud`, user.id],
      );
      for (const lane of company.lanes) {
        await sql(
          `insert into tender_lines (id, pack_id, origin, destination, service, carrier, shipments)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [crypto.randomUUID(), id, lane.origin, lane.destination, lane.service, lane.carrier, lane.shipments],
        );
      }
      send(res, 201, { tender: await tenderDetail(id) });
      return;
    }

    const tender = path.match(/^\/api\/tenders\/([^/]+)$/);
    if (tender && method === "GET") {
      const detail = await tenderDetail(decodeURIComponent(tender[1]));
      if (!detail || !canSee(user, detail.companyId)) {
        send(res, 404, { error: "missing" });
        return;
      }
      send(res, 200, { tender: detail });
      return;
    }
    if (tender && method === "PATCH") {
      const rows = await sql<{ company_id: string }>("select company_id from tender_packs where id = $1", [decodeURIComponent(tender[1])]);
      const pack = rows[0];
      if (!pack || !canSee(user, pack.company_id)) {
        send(res, 404, { error: "missing" });
        return;
      }
      const body = (await readJson(req)) as Record<string, unknown>;
      await sql(
        `update tender_packs set service = $1, exclusions = $2, expectations = $3, updated_at = now() where id = $4`,
        [text(body.service, 500), text(body.exclusions, 500), text(body.expectations, 1000), decodeURIComponent(tender[1])],
      );
      send(res, 200, { tender: await tenderDetail(decodeURIComponent(tender[1])) });
      return;
    }

    const tenderLines = path.match(/^\/api\/tenders\/([^/]+)\/lines$/);
    if (tenderLines && method === "POST") {
      const packId = decodeURIComponent(tenderLines[1]);
      const rows = await sql<{ company_id: string }>("select company_id from tender_packs where id = $1", [packId]);
      const pack = rows[0];
      if (!pack || !canSee(user, pack.company_id)) {
        send(res, 404, { error: "missing" });
        return;
      }
      const body = (await readJson(req)) as Record<string, unknown>;
      const origin = text(body.origin, 80);
      const destination = text(body.destination, 80);
      const service = text(body.service, 80);
      const carrier = text(body.carrier, 80);
      const shipments = Math.round(Number(body.shipments));
      if (!origin || !destination || !service || !carrier || !Number.isFinite(shipments) || shipments <= 0) {
        send(res, 400, { error: "line" });
        return;
      }
      await sql(
        `insert into tender_lines (id, pack_id, origin, destination, service, carrier, shipments, added)
         values ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [crypto.randomUUID(), packId, origin, destination, service, carrier, shipments],
      );
      send(res, 201, { tender: await tenderDetail(packId) });
      return;
    }

    const line = path.match(/^\/api\/tender-lines\/([^/]+)$/);
    if (line && method === "PATCH") {
      const lineId = decodeURIComponent(line[1]);
      const rows = await sql<{ company_id: string; pack_id: string }>(
        `select tender_packs.company_id, tender_lines.pack_id
         from tender_lines join tender_packs on tender_packs.id = tender_lines.pack_id
         where tender_lines.id = $1`,
        [lineId],
      );
      const found = rows[0];
      if (!found || !canSee(user, found.company_id)) {
        send(res, 404, { error: "missing" });
        return;
      }
      const body = (await readJson(req)) as { excluded?: unknown };
      const excluded = body.excluded === true || body.excluded === 1 ? 1 : 0;
      await sql("update tender_lines set excluded = $1 where id = $2", [excluded, lineId]);
      send(res, 200, { tender: await tenderDetail(found.pack_id) });
      return;
    }

    const comments = path.match(/^\/api\/tenders\/([^/]+)\/comments$/);
    if (comments && method === "POST") {
      const packId = decodeURIComponent(comments[1]);
      const rows = await sql<{ company_id: string }>("select company_id from tender_packs where id = $1", [packId]);
      const pack = rows[0];
      if (!pack || !canSee(user, pack.company_id)) {
        send(res, 404, { error: "missing" });
        return;
      }
      if (user.role === "customer" && user.company_id !== pack.company_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const body = (await readJson(req)) as { body?: unknown };
      const comment = text(body.body, 500);
      if (!comment) {
        send(res, 400, { error: "comment" });
        return;
      }
      await sql(
        "insert into tender_comments (id, pack_id, user_id, body) values ($1, $2, $3, $4)",
        [crypto.randomUUID(), packId, user.id, comment],
      );
      send(res, 201, { tender: await tenderDetail(packId) });
      return;
    }

    send(res, 404, { error: "missing" });
  } catch {
    send(res, 500, { error: "server" });
  }
}

function billJson(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    label: String(row.label),
    amount: Number(row.amount),
    source: row.source === "file" ? "file" : "manual",
    carrier: typeof row.carrier === "string" ? row.carrier : undefined,
    addedAt: String(row.created_at),
  };
}

function reportJson(row: Record<string, unknown>) {
  let summary: unknown = {};
  try {
    summary = JSON.parse(String(row.summary));
  } catch {
    summary = {};
  }
  return { id: String(row.id), name: String(row.name), summary, createdAt: String(row.created_at) };
}

async function tenderList(companyId: string) {
  const rows = await sql<{ id: string; title: string; updated_at: string }>(
    "select id, title, updated_at from tender_packs where company_id = $1 order by updated_at desc",
    [companyId],
  );
  return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: String(row.updated_at) }));
}

async function tenderDetail(id: string) {
  const packs = await sql<Record<string, unknown>>("select * from tender_packs where id = $1", [id]);
  const pack = packs[0];
  if (!pack) return null;
  const lines = await sql<Record<string, unknown>>("select * from tender_lines where pack_id = $1 order by added, origin", [id]);
  const comments = await sql<Record<string, unknown>>(
    `select tender_comments.id, tender_comments.body, tender_comments.created_at, users.name
     from tender_comments join users on users.id = tender_comments.user_id
     where tender_comments.pack_id = $1 order by tender_comments.created_at`,
    [id],
  );
  return {
    id: String(pack.id),
    companyId: String(pack.company_id),
    title: String(pack.title),
    service: String(pack.service ?? ""),
    exclusions: String(pack.exclusions ?? ""),
    expectations: String(pack.expectations ?? ""),
    lines: lines.map((line) => ({
      id: String(line.id),
      origin: String(line.origin),
      destination: String(line.destination),
      service: String(line.service),
      carrier: String(line.carrier),
      shipments: Number(line.shipments),
      added: Number(line.added) === 1,
      excluded: Number(line.excluded) === 1,
    })),
    comments: comments.map((comment) => ({
      id: String(comment.id),
      body: String(comment.body),
      name: String(comment.name),
      createdAt: String(comment.created_at),
    })),
  };
}
