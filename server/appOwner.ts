import type { IncomingMessage } from "node:http";
import { getIdentity, type Identity } from "../cursor/identity.ts";

/** Cursor user id of the person who owns this app. The verified viewer must be this person. */
const APP_OWNER_USER_ID = 346683409;

export function viewerMayClaimAdmin(identity: Identity): boolean {
  return (
    identity.verified &&
    identity.kind === "person" &&
    identity.stage === "production" &&
    identity.userId === APP_OWNER_USER_ID
  );
}

export async function requestMayClaimAdmin(req: IncomingMessage): Promise<boolean> {
  return viewerMayClaimAdmin(await getIdentity(req));
}
