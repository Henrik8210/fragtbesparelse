import type { IncomingMessage } from "node:http";
import { getIdentity, verifyIdentity, type HeaderValue, type Identity } from "../cursor/identity.ts";

/** Cursor user id of the person who owns this app. */
const APP_OWNER_USER_ID = 346683409;
/** Same person, matched if the token's numeric id is not the one above. */
const APP_OWNER_EMAIL = "henrikjg2@hotmail.com";

export function viewerMayClaimAdmin(identity: Identity): boolean {
  if (!identity.verified || identity.kind !== "person" || identity.stage !== "production" || identity.userId <= 0) {
    return false;
  }
  if (identity.userId === APP_OWNER_USER_ID) return true;
  return identity.email.toLowerCase() === APP_OWNER_EMAIL;
}

/** A repeated header is an array, or one comma-joined string. A JWT has no comma, so the first piece is the token. */
function oneToken(value: HeaderValue): string | undefined {
  const raw = Array.isArray(value) ? value.find((item) => item.trim() !== "") : value;
  if (typeof raw !== "string") return undefined;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first === "" ? undefined : first;
}

/**
 * The published host puts the identity on a Web Headers object. Spreading that
 * object drops the token, so getIdentity then reports a missing header and the
 * owner is refused. A Node request keeps the header as a string or an array.
 */
function readIdentityToken(req: IncomingMessage): string | undefined {
  const headers = req.headers as { get?: (name: string) => string | null | undefined } & Record<string, HeaderValue>;
  if (typeof headers?.get === "function") {
    for (const name of ["x-cursor-identity-v2", "x-cursor-identity"]) {
      const token = oneToken(headers.get(name) ?? undefined);
      if (token) return token;
    }
    return undefined;
  }
  for (const name of ["x-cursor-identity-v2", "x-cursor-identity"]) {
    const direct = headers?.[name];
    const token = oneToken(direct);
    if (token) return token;
    const key = Object.keys(headers ?? {}).find((item) => item.toLowerCase() === name);
    if (key === undefined) continue;
    const cased = oneToken(headers[key]);
    if (cased) return cased;
  }
  return undefined;
}

export async function requestMayClaimAdmin(req: IncomingMessage): Promise<boolean> {
  const token = readIdentityToken(req);
  const identity = token ? await verifyIdentity(token) : await getIdentity(req);
  return viewerMayClaimAdmin(identity);
}
