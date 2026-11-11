import type { IncomingMessage } from "node:http";
import { getIdentity, type HeaderValue, type Identity } from "../cursor/identity.ts";

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

/** A repeated identity header is an array, or one comma-joined string. Either form must stay a single token or verification fails. */
function oneToken(value: HeaderValue): string | undefined {
  const raw = Array.isArray(value) ? value.find((item) => item.trim() !== "") : value;
  if (typeof raw !== "string") return undefined;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first === "" ? undefined : first;
}

function identityHeaders(req: IncomingMessage): Record<string, HeaderValue> {
  const headers: Record<string, HeaderValue> = { ...req.headers };
  for (const name of ["x-cursor-identity-v2", "x-cursor-identity"]) {
    const token = oneToken(headers[name]);
    if (token === undefined) delete headers[name];
    else headers[name] = token;
  }
  return headers;
}

export async function requestMayClaimAdmin(req: IncomingMessage): Promise<boolean> {
  return viewerMayClaimAdmin(await getIdentity(identityHeaders(req)));
}
