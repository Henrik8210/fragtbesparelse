import type { IncomingMessage } from "node:http";
import { getIdentity, verifyIdentity, type HeaderValue, type Identity, type IdentityFailureReason } from "../cursor/identity.ts";

/** Cursor user id of the person who owns this app. */
const APP_OWNER_USER_ID = 346683409;

const IDENTITY_NAMES = ["x-cursor-identity-v2", "x-cursor-identity"] as const;

export function viewerMayClaimAdmin(identity: Identity): boolean {
  if (!identity.verified || identity.kind !== "person" || identity.userId <= 0) return false;
  return identity.userId === APP_OWNER_USER_ID;
}

/** A repeated header is an array, or one comma-joined string. A JWT has no comma, so the first piece is the token. */
function oneToken(value: HeaderValue): string | undefined {
  const raw = Array.isArray(value) ? value.find((item) => item.trim() !== "") : value;
  if (typeof raw !== "string") return undefined;
  const first = (raw.split(",")[0]?.trim() ?? "").replace(/^Bearer\s+/i, "");
  if (first.split(".").length !== 3) return undefined;
  return first;
}

function tokenFromHeaders(headers: IncomingMessage["headers"] | undefined): string | undefined {
  if (headers == null) return undefined;
  const readable = headers as { get?: (name: string) => string | null | undefined } & Record<string, HeaderValue>;
  for (const name of IDENTITY_NAMES) {
    if (typeof readable.get === "function") {
      const token = oneToken(readable.get(name) ?? undefined);
      if (token) return token;
    }
    const direct = oneToken(readable[name]);
    if (direct) return direct;
    const key = Object.keys(readable).find((item) => item.toLowerCase() === name);
    if (key === undefined) continue;
    const cased = oneToken(readable[key]);
    if (cased) return cased;
  }
  return undefined;
}

function tokenFromRaw(req: IncomingMessage): string | undefined {
  const raw = req.rawHeaders;
  if (!Array.isArray(raw)) return undefined;
  for (const name of IDENTITY_NAMES) {
    for (let index = 0; index < raw.length - 1; index += 2) {
      const headerName = raw[index];
      if (typeof headerName !== "string" || headerName.toLowerCase() !== name) continue;
      const token = oneToken(raw[index + 1]);
      if (token) return token;
    }
  }
  return undefined;
}

function readIdentityToken(req: IncomingMessage): string | undefined {
  return tokenFromHeaders(req.headers) ?? tokenFromRaw(req);
}

async function resolveIdentity(req: IncomingMessage): Promise<Identity> {
  const direct = await getIdentity(req);
  if (viewerMayClaimAdmin(direct)) return direct;
  const token = readIdentityToken(req);
  if (!token) return direct;
  const checked = await verifyIdentity(token);
  if (checked.verified) return checked;
  return direct.verified ? direct : checked;
}

/** Null when the verified app owner may create a user. Otherwise a stable error code, never a token. */
export async function ownerDenial(req: IncomingMessage): Promise<IdentityFailureReason | "not_owner" | null> {
  const identity = await resolveIdentity(req);
  if (viewerMayClaimAdmin(identity)) return null;
  if (!identity.verified) return identity.reason;
  return "not_owner";
}

export async function requestMayClaimAdmin(req: IncomingMessage): Promise<boolean> {
  return (await ownerDenial(req)) === null;
}
