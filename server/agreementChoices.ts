import { postgresSql, storesInPostgres } from "./db.ts";

export type ChoiceStore = "postgres" | "memory";

/** The price agreement a person chose for one invoice file instead of the one valid on its dates. */
export type AgreementChoice = {
  companyId: string;
  fileId: string;
  agreementId: string;
  chosenBy: string;
  chosenByName: string;
  chosenAt: string;
};

const MEMORY_KEEP = 2000;
const memory = new Map<string, AgreementChoice>();
// When the table is missing, retry it now and then so creating it takes effect without a restart.
const RETRY_MS = 5 * 60 * 1000;
let missingSince = 0;

function key(companyId: string, fileId: string) {
  return `${companyId}\n${fileId}`;
}

function tableUsable(): boolean {
  return storesInPostgres() && (missingSince === 0 || Date.now() - missingSince > RETRY_MS);
}

function absent(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" || /invoice_agreement_choices.*does not exist|does not exist.*invoice_agreement_choices/i.test(message) || /DATABASE_URL is not set/.test(message);
}

export function choiceStore(): ChoiceStore {
  return tableUsable() ? "postgres" : "memory";
}

type Row = { company_id: string; file_id: string; agreement_id: string; chosen_by: string; chosen_by_name: string; chosen_at: Date | string };

export function fromRow(row: Row): AgreementChoice {
  return {
    companyId: row.company_id,
    fileId: row.file_id,
    agreementId: row.agreement_id,
    chosenBy: row.chosen_by,
    chosenByName: row.chosen_by_name,
    chosenAt: row.chosen_at instanceof Date ? row.chosen_at.toISOString() : new Date(String(row.chosen_at)).toISOString(),
  };
}

function remember(choice: AgreementChoice) {
  const id = key(choice.companyId, choice.fileId);
  memory.delete(id);
  memory.set(id, choice);
  while (memory.size > MEMORY_KEEP) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

async function attempt<T>(query: () => Promise<T>): Promise<{ done: true; value: T } | { done: false }> {
  if (!tableUsable()) return { done: false };
  try {
    return { done: true, value: await query() };
  } catch (error) {
    if (!absent(error)) throw error;
    missingSince = Date.now();
    return { done: false };
  }
}

export const UPSERT_SQL = `insert into public.invoice_agreement_choices (company_id, file_id, agreement_id, chosen_by, chosen_by_name, chosen_at)
  values ($1, $2, $3, $4, $5, $6)
  on conflict (company_id, file_id) do update
  set agreement_id = excluded.agreement_id, chosen_by = excluded.chosen_by,
      chosen_by_name = excluded.chosen_by_name, chosen_at = excluded.chosen_at`;

export function upsertParams(choice: AgreementChoice) {
  return [choice.companyId, choice.fileId, choice.agreementId, choice.chosenBy, choice.chosenByName, choice.chosenAt];
}

export async function listChoices(companyId: string): Promise<{ choices: AgreementChoice[]; store: ChoiceStore }> {
  const stored = await attempt(() => postgresSql<Row>("select * from public.invoice_agreement_choices where company_id = $1", [companyId]));
  if (stored.done) return { choices: stored.value.map(fromRow), store: "postgres" };
  return { choices: [...memory.values()].filter((choice) => choice.companyId === companyId), store: "memory" };
}

export async function saveChoice(input: Omit<AgreementChoice, "chosenAt">, now = new Date()): Promise<{ choice: AgreementChoice; store: ChoiceStore }> {
  const choice: AgreementChoice = { ...input, chosenAt: now.toISOString() };
  const stored = await attempt(() => postgresSql(UPSERT_SQL, upsertParams(choice)));
  if (stored.done) return { choice, store: "postgres" };
  remember(choice);
  return { choice, store: "memory" };
}

/** Removing the choice puts the invoice back on the agreement valid on its dates. */
export async function clearChoice(companyId: string, fileId: string): Promise<{ store: ChoiceStore }> {
  const stored = await attempt(() => postgresSql("delete from public.invoice_agreement_choices where company_id = $1 and file_id = $2", [companyId, fileId]));
  memory.delete(key(companyId, fileId));
  return { store: stored.done ? "postgres" : "memory" };
}

export const CLEAR_AGREEMENT_SQL = "delete from public.invoice_agreement_choices where company_id = $1 and agreement_id = $2 returning file_id";

/** Drops every choice of a deleted agreement in that company, so those invoices are matched on their dates again. */
export async function clearChoicesForAgreement(companyId: string, agreementId: string): Promise<{ cleared: string[]; store: ChoiceStore }> {
  const cleared = new Set<string>();
  for (const [id, choice] of memory) {
    if (choice.companyId === companyId && choice.agreementId === agreementId) {
      memory.delete(id);
      cleared.add(choice.fileId);
    }
  }
  const stored = await attempt(() => postgresSql<{ file_id: string }>(CLEAR_AGREEMENT_SQL, [companyId, agreementId]));
  if (stored.done) for (const row of stored.value) cleared.add(row.file_id);
  return { cleared: [...cleared], store: stored.done ? "postgres" : "memory" };
}
