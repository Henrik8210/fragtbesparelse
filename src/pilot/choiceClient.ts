import { api } from "../api.ts";

export type AgreementChoice = { fileId: string; agreementId: string; chosenByName: string; chosenAt: string };

const lists = new Map<string, Promise<Map<string, AgreementChoice>>>();

/** Manual agreement choices for a company's invoice files, by file id. */
export function loadChoices(companyId: string): Promise<Map<string, AgreementChoice>> {
  const hit = lists.get(companyId);
  if (hit) return hit;
  const load = api<{ choices: AgreementChoice[] }>(`/api/agreement-choices?company=${encodeURIComponent(companyId)}`)
    .then((body) => new Map(body.choices.map((choice) => [choice.fileId, choice])))
    .catch((error: unknown) => {
      lists.delete(companyId);
      throw error;
    });
  lists.set(companyId, load);
  return load;
}

/** Saves or, with an empty id, removes the choice, so the invoice is matched on its dates again. */
export async function setChoice(companyId: string, fileId: string, agreementId: string): Promise<AgreementChoice | null> {
  const path = `/api/agreement-choices/${encodeURIComponent(fileId)}?company=${encodeURIComponent(companyId)}`;
  const saved = agreementId
    ? (await api<{ choice: AgreementChoice }>(path, { method: "PUT", body: JSON.stringify({ agreementId }) })).choice
    : (await api(path, { method: "DELETE" }), null);
  const current = await loadChoices(companyId).catch(() => new Map<string, AgreementChoice>());
  const next = new Map(current);
  if (saved) next.set(fileId, saved);
  else next.delete(fileId);
  lists.set(companyId, Promise.resolve(next));
  return saved;
}
