export type Notice = {
  id: string;
  kind: "demo" | "invoice";
  name: string;
  company: string;
  email: string;
  subject: string;
  createdAt: string;
  seenAt: string | null;
};

export type NoticeTarget =
  | { kind: "invoice"; orgId: string; mailId: string }
  | { kind: "mail"; href: string }
  | null;

const ZONE = "Europe/Copenhagen";

export function noticeText(item: Notice, orgs: { id: string; name: string }[]): { title: string; lines: string[]; action: string } {
  if (item.kind === "invoice") {
    const orgName = orgs.find((org) => org.id === item.company)?.name ?? item.company;
    return {
      title: item.name ? `Faktura modtaget fra ${item.name}` : "Faktura modtaget",
      lines: [[item.subject, orgName].filter(Boolean).join(" · ")],
      action: "Åbn faktura",
    };
  }
  return { title: "Demoønske", lines: [`${item.name} · ${item.company}`, item.email], action: "Svar på mail" };
}

/** Where a click on the notice leads: the invoice on Fakturaer, or a reply to the person who asked for a demo. */
export function noticeTarget(item: Notice): NoticeTarget {
  if (item.kind === "invoice") return item.company && item.id ? { kind: "invoice", orgId: item.company, mailId: item.id } : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)) return null;
  return { kind: "mail", href: `mailto:${encodeURIComponent(item.email).replace(/%40/g, "@")}?subject=${encodeURIComponent("Demo af Freightlytics")}` };
}

function dayKey(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ZONE }).format(value);
}

function previousDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  noon.setUTCDate(noon.getUTCDate() - 1);
  return noon.toISOString().slice(0, 10);
}

function dayLabel(key: string, today: string): string {
  if (key === today) return "I dag";
  if (key === previousDay(today)) return "I går";
  const [year, month, day] = key.split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  const label = new Intl.DateTimeFormat("da-DK", {
    weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: ZONE,
  }).format(noon);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function noticeTime(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: ZONE }).format(new Date(value));
}

/** Notices newest first, one group per Copenhagen calendar day. */
export function groupByDay(notices: Notice[], now = new Date()): { key: string; label: string; items: Notice[] }[] {
  const today = dayKey(now);
  const sorted = [...notices].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  const groups: { key: string; label: string; items: Notice[] }[] = [];
  for (const item of sorted) {
    const created = new Date(item.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const key = dayKey(created);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(key, today), items: [item] });
  }
  return groups;
}
