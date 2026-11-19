import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api.ts";
import { loadChoices, setChoice, type AgreementChoice } from "./choiceClient.ts";

/** The saved manual agreement choice for an invoice file, with a setter that stores it. */
export function useAgreementChoice(companyId: string, fileId: string) {
  const [state, setState] = useState<{ key: string; choice: AgreementChoice | null }>({ key: "", choice: null });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState({ key: "", message: "" });
  const key = `${companyId}\n${fileId}`;
  useEffect(() => {
    if (!fileId) return;
    let gone = false;
    loadChoices(companyId).then(
      (choices) => { if (!gone) setState({ key, choice: choices.get(fileId) ?? null }); },
      () => { if (!gone) setState({ key, choice: null }); },
    );
    return () => { gone = true; };
  }, [companyId, fileId, key]);

  const choose = useCallback(async (agreementId: string) => {
    if (!fileId) {
      setState({ key, choice: agreementId ? { fileId: "", agreementId, chosenByName: "", chosenAt: "" } : null });
      return;
    }
    setSaving(true);
    setFailed({ key, message: "" });
    try {
      setState({ key, choice: await setChoice(companyId, fileId, agreementId) });
    } catch (error) {
      setFailed({ key, message: error instanceof ApiError && error.message !== error.code ? error.message : "Valget blev ikke gemt. Prøv igen." });
    } finally {
      setSaving(false);
    }
  }, [companyId, fileId, key]);

  return { choice: state.key === key ? state.choice : null, choose, saving, problem: failed.key === key ? failed.message : "" };
}
