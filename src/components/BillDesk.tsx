import { useId, useState, type FormEvent } from "react";
import { LATEST_MONTH, MONTHS } from "../data/portfolio.ts";
import { formatKr } from "../format.ts";
import { parseAmount } from "../bills/parse.ts";
import { BillReadError, readBillFile } from "../bills/read.ts";
import { useBills } from "../bills.tsx";
import { carrierProfiles, knownCarrier } from "../data/carriers.ts";
import { useLanguage } from "../language.tsx";
import type { MessageKey } from "../i18n/messages.ts";
import type { Customer } from "../types.ts";

type Mode = "closed" | "choose" | "manual" | "upload";

export function BillDesk({ customer }: { customer: Customer }) {
  const { bills, total, addBill, removeBill } = useBills(customer.id);
  const { t, phrase } = useLanguage();
  const month = phrase(`month.${MONTHS[MONTHS.length - 1].id}`, LATEST_MONTH);
  const [mode, setMode] = useState<Mode>("closed");
  const [carrier, setCarrier] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const formId = useId();
  const hasBills = bills.length > 0;

  function openChooser() {
    setErrors([]);
    setMode((current) => (current === "closed" ? "choose" : "closed"));
  }

  function addManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const label = String(data.get("label") ?? "");
    const amount = parseAmount(String(data.get("amount") ?? ""));
    if (!knownCarrier(carrier)) {
      setErrors([t("bills.needCarrier")]);
      return;
    }
    if (amount == null) {
      setErrors([t("bills.needAmount")]);
      return;
    }
    addBill({ label, amount, source: "manual", carrier });
    setCarrier("");
    form.reset();
    setErrors([]);
    setMode("closed");
  }

  async function addFile(fileList: FileList | null) {
    if (!knownCarrier(carrier)) {
      setErrors([t("bills.needCarrier")]);
      return;
    }
    const files = fileList ? [...fileList] : [];
    if (files.length === 0) return;
    setReading(true);
    setErrors([]);
    const nextErrors: string[] = [];
    for (const file of files) {
      try {
        const read = await readBillFile(file, t("bills.fallbackName"));
        addBill({ label: read.label, amount: read.amount, source: "file", carrier });
      } catch (error) {
        nextErrors.push(readProblem(error, t));
      }
    }
    setErrors(nextErrors);
    setReading(false);
    if (nextErrors.length === 0) {
      setCarrier("");
      setMode("closed");
    }
  }

  return (
    <>
      <h1>{t("bills.title")}</h1>
      <p className="meta">{customer.name}</p>
      <p className="lede">{t("bills.lede", { month })}</p>

      {hasBills ? (
        <div className="bill-toolbar">
          <h2>{t("bills.onAccount")}</h2>
          <AddBillMenu
            mode={mode}
            formId={formId}
            reading={reading}
            errors={errors}
            compact
            label={t("bills.add")}
            carrier={carrier}
            onCarrier={setCarrier}
            onToggle={openChooser}
            onChoose={setMode}
            onManual={addManual}
            onFile={addFile}
          />
        </div>
      ) : (
        <div className="bill-empty">
          <AddBillMenu
            mode={mode}
            formId={formId}
            reading={reading}
            errors={errors}
            label={t("bills.addFirst")}
            carrier={carrier}
            onCarrier={setCarrier}
            onToggle={openChooser}
            onChoose={setMode}
            onManual={addManual}
            onFile={addFile}
          />
          <p>{t("bills.empty")}</p>
        </div>
      )}

      {hasBills ? (
        <section className="bill-lines" aria-label={`Bills added for ${customer.name}`}>
          <ul className="seat-list">
            {bills.map((bill) => (
              <li key={bill.id}>
                <span>
                  <span className="seat-role">{bill.label}</span>
                  <span className="seat-person-role">
                    {bill.carrier ? `${bill.carrier} · ` : ""}
                    {bill.source === "file" ? t("bills.uploaded") : t("bills.typed")}
                  </span>
                </span>
                <span className="bill-line-end">
                  <span>{formatKr(bill.amount)}</span>
                  <button type="button" className="bill-remove" onClick={() => removeBill(bill.id)}>
                    {t("common.remove")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="bill-total">
            <span>{t("bills.total", { month })}</span>
            <span>{formatKr(total)}</span>
          </p>
        </section>
      ) : null}
    </>
  );
}

function AddBillMenu({
  mode,
  formId,
  reading,
  errors,
  compact = false,
  label,
  carrier,
  onCarrier,
  onToggle,
  onChoose,
  onManual,
  onFile,
}: {
  mode: Mode;
  formId: string;
  reading: boolean;
  errors: string[];
  compact?: boolean;
  label: string;
  carrier: string;
  onCarrier: (carrier: string) => void;
  onToggle: () => void;
  onChoose: (mode: Mode) => void;
  onManual: (event: FormEvent<HTMLFormElement>) => void;
  onFile: (files: FileList | null) => Promise<void>;
}) {
  const { t } = useLanguage();
  const open = mode !== "closed";
  return (
    <div className="bill-add">
      {open ? (
        <button type="button" className="bill-pop-backdrop" aria-label={t("bills.close")} onClick={() => onChoose("closed")} />
      ) : null}
      <button
        type="button"
        className={compact ? "bill-plus is-small" : "bill-plus"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={formId}
        onClick={onToggle}
      >
        <span aria-hidden="true">+</span>
        <span className="sr-only">{label}</span>
      </button>
      {open ? (
        <div
          className="bill-pop"
          id={formId}
          role="dialog"
          aria-label="Add a bill"
          onKeyDown={(event) => {
            if (event.key === "Escape") onChoose("closed");
          }}
        >
          <label className="bill-field">
            <span>{t("bills.carrier")}</span>
            <select value={carrier} onChange={(event) => onCarrier(event.target.value)}>
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
              <button type="button" className="bill-choice" autoFocus onClick={() => onChoose("manual")}>
                {t("bills.type")}
              </button>
              <button type="button" className="bill-choice" onClick={() => onChoose("upload")}>
                {t("bills.upload")}
              </button>
            </div>
          ) : null}
          {mode === "manual" ? (
            <form className="bill-form" onSubmit={onManual}>
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
                  {t("bills.addBill")}
                </button>
                <button type="button" className="bill-back" onClick={() => onChoose("choose")}>
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
                  multiple
                  disabled={reading}
                  autoFocus
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void onFile(input.files).finally(() => {
                      input.value = "";
                    });
                  }}
                />
              </label>
              <p className="hint">
                {reading
                  ? t("bills.reading")
                  : t("bills.fileHint")}
              </p>
              <button type="button" className="bill-back" onClick={() => onChoose("choose")}>
                {t("common.back")}
              </button>
            </div>
          ) : null}
          {errors.length > 0 ? (
            <ul className="bill-errors">
              {errors.map((error, index) => (
                <li key={`${index}-${error}`}>{error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function readProblem(
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
