export type CachedUser = { role: string } | null;
export type CachedCompany = { id: string; name: string; industry: string; place: string };
export type CachedNotice = {
  id: string;
  kind: "demo" | "invoice";
  name: string;
  company: string;
  email: string;
  subject: string;
  createdAt: string;
  seenAt: string | null;
};
export type CachedMailFile = { id: string; filename: string; bytes: number; carrier?: string };
export type CachedMail = {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
  files: CachedMailFile[];
};
export type CachedMailbox = { address: string; ready: boolean; error: string; mails: CachedMail[] };

const memory: {
  me?: CachedUser;
  orgs?: CachedCompany[];
  notices?: CachedNotice[];
  mail: Map<string, CachedMailbox>;
} = { mail: new Map() };

let epoch = 0;

export function cacheEpoch(): number {
  return epoch;
}

export function readMe(): CachedUser | undefined {
  return memory.me;
}

export function rememberMe(user: CachedUser) {
  memory.me = user;
}

export function readOrgs(): CachedCompany[] | undefined {
  return memory.orgs;
}

export function rememberOrgs(orgs: CachedCompany[]) {
  memory.orgs = orgs;
}

export function readNotices(): CachedNotice[] | undefined {
  return memory.notices;
}

export function rememberNotices(notices: CachedNotice[]) {
  memory.notices = notices;
}

export function mailKey(admin: boolean, orgId: string): string {
  return `${admin ? "admin" : "member"}:${orgId}`;
}

export function readMail(key: string): CachedMailbox | undefined {
  return memory.mail.get(key);
}

export function rememberMail(key: string, mailbox: CachedMailbox) {
  memory.mail.set(key, mailbox);
}

export function clearWorkspaceCache() {
  epoch += 1;
  memory.me = undefined;
  memory.orgs = undefined;
  memory.notices = undefined;
  memory.mail.clear();
}
