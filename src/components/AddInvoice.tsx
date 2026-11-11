import { useId, useState, type FormEvent } from "react";
import { parseAmount } from "../bills/parse.ts";
import { BillReadError, readBillFile } from "../bills/read.ts";
import { useBills } from "../bills.tsx";
import { carrierProfiles, knownCarrier } from "../data/carriers.ts";
import { useLanguage } from "../language.tsx";
import type { MessageKey } from "../i18n/messages.ts";

type Mode = "closed" | "choose" | "manual" | "upload";

export function AddInvoice({ customerId }: { customerId: string }) {
  const { addBill } = useBills(customerId);
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>("closed");
  const [carrier, setCarrier] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const formId = useId();

  function close() {
    setMode("closed");
    setErrors([]);
  }

  function requireCarrier(): string | null {
    if (!knownCarrier(carrier)) {
      setErrors([t("bills.needCarrier")]);
      return null;
    }
    setErrors([]);
    return carrier;
  }

  function addManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = requireCarrier();
    if (!chosen) return;
    const data = new FormData(event.currentTarget);
    const amount = parseAmount(String(data.get("amount") ?? ""));
    if (amount == null) {
      setErrors([t("bills.needAmount")]);
      return;
    }
    addBill({
      label: String(data.get("label") ?? ""),
      amount,
      source: "manual",
      carrier: chosen,
    });
    setCarrier("");
    close();
  }

  async function addFile(fileList: FileList | null) {
    const chosen = requireCarrier();
    if (!chosen) return;
    const files = fileList ? [...fileList] : [];
    if (files.length === 0) return;
    setReading(true);
    setErrors([]);
    const nextErrors: string[] = [];
    for (const file of files) {
      try {
        const read = await readBillFile(file, t("bills.fallbackName"));
        addBill({ label: read.label, amount: read.amount, source: "file", carrier: chosen });
      } catch (error) {
        nextErrors.push(billProblem(error, t));
      }
    }
    setErrors(nextErrors);
    setReading(false);
    if (nextErrors.length === 0) {
      setCarrier("");
      close();
    }
  }

  const open = mode !== "closed";

  return (
    <div className="bill-add invoice-add">
      {open ? (
        <button type="button" className="bill-pop-backdrop" aria-label={t("invoice.close")} onClick={close} />
      ) : null}
      <button
        type="button"
        className="invoice-add-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={formId}
        onClick={() => (open ? close() : setMode("choose"))}
      >
        {t("invoice.add")}
      </button>
      {open ? (
        <div
          className="bill-pop"
          id={formId}
          role="dialog"
          aria-label={t("invoice.add")}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <label className="bill-field">
            <span>{t("bills.carrier")}</span>
            <select value={carrier} onChange={(event) => setCarrier(event.target.value)}>
              <option value="">{t("bills.chooseCarrier")}</option>
              {carrierProfiles.map((profile) => (
                <option key={profile.name} value={profile.name}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          {mode === "choose" ? (
            <div className="bill-choices">
              <button type="button" className="bill-choice" onClick={() => setMode("manual")}>
                {t("bills.type")}
              </button>
              <button type="button" className="bill-choice" onClick={() => setMode("upload")}>
                {t("bills.upload")}
              </button>
            </div>
          ) : null}
          {mode === "manual" ? (
            <form className="bill-form" onSubmit={addManual}>
              <label className="bill-field">
                <span>{t("common.description")}</span>
                <input name="label" type="text" maxLength={120} placeholder={t("bills.invoiceNumber")} autoFocus />
              </label>
              <label className="bill-field">
                <span>{t("common.amount")}</span>
                <input name="amount" type="text" inputMode="decimal" required placeholder="12.400" />
              </label>
              <div className="bill-actions">
                <button type="submit" className="bill-choice is-submit">
                  {t("invoice.addSubmit")}
                </button>
                <button
                  type="button"
                  className="bill-back"
                  onClick={() => {
                    setErrors([]);
                    setMode("choose");
                  }}
                >
                  {t("common.back")}
                </button>
              </div>
            </form>
          ) : null}
          {mode === "upload" ? (
            <div className="bill-form">
              <label className="bill-field">
                <span>{t("bills.file")}</span>
                <input
                  type="file"
                  accept=".pdf,.csv,.txt,text/plain,text/csv,application/pdf"
                  disabled={reading}
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void addFile(input.files).finally(() => {
                      input.value = "";
                    });
                  }}
                />
              </label>
              <p className="hint">{t("invoice.fileHint")}</p>
              <button
                type="button"
                className="bill-back"
                onClick={() => {
                  setErrors([]);
                  setMode("choose");
                }}
              >
                {t("common.back")}
              </button>
            </div>
          ) : null}
          {errors.length > 0 ? (
            <ul className="bill-errors">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function billProblem(
  error: unknown,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (error instanceof BillReadError) {
    if (error.code === "too-big") return t("bills.tooBig", { label: error.label });
    if (error.code === "empty") return t("bills.emptyFile", { label: error.label });
    return t("bills.noAmount", { label: error.label });
  }
  return t("bills.unreadable");
}
