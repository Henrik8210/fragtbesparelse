import { api } from "../api.ts";
import { browserAgreementInput, type AgreementCreate, type AgreementPatch, type AgreementRecord } from "./agreementRecord.ts";
import { loadAgreements, saveAgreements } from "./agreements.ts";

export type AgreementStore = "postgres" | "memory";

const query = (companyId: string) => `?company=${encodeURIComponent(companyId)}`;

export function listPriceAgreements(companyId: string): Promise<{ agreements: AgreementRecord[]; store: AgreementStore }> {
  return api(`/api/price-agreements${query(companyId)}`);
}

export function createPriceAgreement(companyId: string, input: AgreementCreate): Promise<{ agreement: AgreementRecord; store: AgreementStore }> {
  return api(`/api/price-agreements${query(companyId)}`, { method: "POST", body: JSON.stringify(input) });
}

export function updatePriceAgreement(companyId: string, id: string, patch: AgreementPatch): Promise<{ agreement: AgreementRecord; store: AgreementStore }> {
  return api(`/api/price-agreements/${encodeURIComponent(id)}${query(companyId)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deletePriceAgreement(companyId: string, id: string): Promise<{ deleted: string; store: AgreementStore }> {
  return api(`/api/price-agreements/${encodeURIComponent(id)}${query(companyId)}`, { method: "DELETE" });
}

/**
 * Moves this browser's localStorage agreements for one company into the database. They are removed from
 * localStorage only once the server says they are in Postgres; with the table missing they stay put.
 */
export async function migrateBrowserAgreements(companyId: string): Promise<number> {
  const local = loadAgreements();
  const mine = local.filter((item) => item.orgId === companyId && !item.sample);
  if (!mine.length) return 0;
  const agreements = mine.map(browserAgreementInput).filter((item): item is AgreementCreate => item !== null);
  const result = await api<{ imported: string[]; skipped: string[]; store: AgreementStore }>(
    `/api/price-agreements/import${query(companyId)}`,
    { method: "POST", body: JSON.stringify({ agreements }) },
  );
  if (result.store !== "postgres") return 0;
  const done = new Set(result.imported);
  saveAgreements(loadAgreements().filter((item) => !done.has(item.id)));
  return done.size;
}
