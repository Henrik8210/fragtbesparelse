import { benchmarkSamples, type AuditInput, type AuditReport, type Contribution, type Coverage, type SavedAudit } from "./freight.ts";

const KEY = "fragtblik-pilot-audits";

export type StoredAudit = SavedAudit & {
  samples: { group: string; cvr: string }[];
  orgId?: string;
};

export function loadAudits(): StoredAudit[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredAudit[]) : [];
  } catch {
    return [];
  }
}

export function saveAudits(items: StoredAudit[]) {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, 100)));
}

export function recordAudit(input: AuditInput, report: AuditReport, contribution: Contribution | null, orgId: string): StoredAudit {
  const samples = contribution
    ? benchmarkSamples(report, contribution.volume).map((sample) => ({ group: sample.group, cvr: contribution.cvr }))
    : [];
  return {
    id: crypto.randomUUID(),
    name: input.name,
    carrier: input.carrier,
    createdAt: new Date().toISOString(),
    summary: report.summary,
    contributed: Boolean(contribution),
    sampleCount: samples.length,
    report,
    samples,
    orgId,
  };
}

export function coverageOf(items: StoredAudit[]): Coverage {
  const groups: Record<string, Set<string>> = {};
  const companies = new Set<string>();
  for (const item of items) {
    for (const sample of item.samples) {
      companies.add(sample.cvr);
      const set = groups[sample.group] ?? new Set<string>();
      set.add(sample.cvr);
      groups[sample.group] = set;
    }
  }
  const counts: Record<string, number> = {};
  for (const [key, set] of Object.entries(groups)) counts[key] = set.size;
  return { groups: counts, companies: companies.size };
}
