import { api } from "../api.ts";
import type { CheckLine, CheckSummary, InvoiceCheck } from "./invoiceCheck.ts";

export type CheckStore = "postgres" | "memory";

const KEEP = 60;
const checks = new Map<string, Promise<InvoiceCheck | null>>();

const slot = (fileId: string, companyId: string) => `${companyId}\n${fileId}`;

function keep(key: string, value: Promise<InvoiceCheck | null>) {
  checks.delete(key);
  checks.set(key, value);
  while (checks.size > KEEP) {
    const oldest = checks.keys().next().value;
    if (oldest === undefined) break;
    checks.delete(oldest);
  }
}

export async function listInvoiceChecks(companyId: string): Promise<{ checks: CheckSummary[]; store: CheckStore }> {
  return api(`/api/invoice-checks?company=${encodeURIComponent(companyId)}`);
}

export function fetchInvoiceCheck(fileId: string, companyId: string): Promise<InvoiceCheck | null> {
  const key = slot(fileId, companyId);
  const hit = checks.get(key);
  if (hit) return hit;
  const load = api<{ check: InvoiceCheck | null }>(`/api/invoice-checks/${encodeURIComponent(fileId)}?company=${encodeURIComponent(companyId)}`)
    .then((body) => body.check)
    .catch((error: unknown) => {
      checks.delete(key);
      throw error;
    });
  keep(key, load);
  return load;
}

export async function saveInvoiceCheck(fileId: string, companyId: string, original: CheckLine[], lines: CheckLine[]): Promise<{ check: InvoiceCheck; store: CheckStore }> {
  const saved = await api<{ check: InvoiceCheck; store: CheckStore }>(
    `/api/invoice-checks/${encodeURIComponent(fileId)}?company=${encodeURIComponent(companyId)}`,
    { method: "PUT", body: JSON.stringify({ original, lines }) },
  );
  keep(slot(fileId, companyId), Promise.resolve(saved.check));
  return saved;
}
