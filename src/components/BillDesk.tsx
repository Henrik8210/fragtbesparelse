import { useId, useState, type FormEvent } from "react";
import { LATEST_MONTH } from "../data/portfolio.ts";
import { formatKr } from "../format.ts";
import { parseAmount } from "../bills/parse.ts";
import { readBillFile } from "../bills/read.ts";
import { useBills } from "../bills.tsx";
import type { Customer } from "../types.ts";

type Mode = "closed" | "choose" | "manual" | "upload";

export function BillDesk({ customer }: { customer: Customer }) {
  const { bills, total, addBill, removeBill } = useBills(customer.id);
  const [mode, setMode] = useState<Mode>("closed");
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
    if (amount == null) {
      setErrors(["Enter the amount, for example 12.400 or 12400,50."]);
      return;
    }
    addBill({ label, amount, source: "manual" });
    form.reset();
    setErrors([]);
    setMode("closed");
  }

  async function addFile(fileList: FileList | null) {
    const files = fileList ? [...fileList] : [];
    if (files.length === 0) return;
    setReading(true);
    setErrors([]);
    const nextErrors: string[] = [];
    for (const file of files) {
      try {
        const read = await readBillFile(file);
        addBill({ label: read.label, amount: read.amount, source: "file" });
      } catch (error) {
        nextErrors.push(error instanceof Error ? error.message : "That file could not be read.");
      }
    }
    setErrors(nextErrors);
    setReading(false);
    if (nextErrors.length === 0) setMode("closed");
  }

  return (
    <>
      <h1>Bills</h1>
      <p className="meta">{customer.name}</p>
      <p className="lede">
        Add a freight bill for {LATEST_MONTH}. Type the amount, or upload a text PDF, CSV, or plain
        text file. Fairlane reads the total and adds it to this account&apos;s spend. The bill stays in
        this browser.
      </p>

      {hasBills ? (
        <div className="bill-toolbar">
          <h2>On this account</h2>
          <AddBillMenu
            mode={mode}
            formId={formId}
            reading={reading}
            errors={errors}
            compact
            label="Add a bill"
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
            label="Add the first bill"
            onToggle={openChooser}
            onChoose={setMode}
            onManual={addManual}
            onFile={addFile}
          />
          <p>Add the first bill. Type the amount, or upload the file.</p>
        </div>
      )}

      {hasBills ? (
        <section className="bill-lines" aria-label={`Bills added for ${customer.name}`}>
          <ul className="seat-list">
            {bills.map((bill) => (
              <li key={bill.id}>
                <span>
                  <span className="seat-role">{bill.label}</span>
                  <span className="seat-person-role">{bill.source === "file" ? "Uploaded" : "Typed in"}</span>
                </span>
                <span className="bill-line-end">
                  <span>{formatKr(bill.amount)}</span>
                  <button type="button" className="bill-remove" onClick={() => removeBill(bill.id)}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="bill-total">
            <span>Added to {LATEST_MONTH} spend</span>
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
  onToggle: () => void;
  onChoose: (mode: Mode) => void;
  onManual: (event: FormEvent<HTMLFormElement>) => void;
  onFile: (files: FileList | null) => Promise<void>;
}) {
  const open = mode !== "closed";
  return (
    <div className="bill-add">
      {open ? (
        <button type="button" className="bill-pop-backdrop" aria-label="Close add bill" onClick={() => onChoose("closed")} />
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
          {mode === "choose" ? (
            <div className="bill-choices">
              <button type="button" className="bill-choice" autoFocus onClick={() => onChoose("manual")}>
                Type the amount
              </button>
              <button type="button" className="bill-choice" onClick={() => onChoose("upload")}>
                Upload a bill
              </button>
            </div>
          ) : null}
          {mode === "manual" ? (
            <form className="bill-form" onSubmit={onManual}>
              <label className="bill-field">
                <span>Description</span>
                <input name="label" type="text" maxLength={120} placeholder="Carrier or invoice number" autoFocus />
              </label>
              <label className="bill-field">
                <span>Amount</span>
                <input name="amount" type="text" inputMode="decimal" required placeholder="12.400" />
              </label>
              <div className="bill-actions">
                <button type="submit" className="bill-choice is-submit">
                  Add bill
                </button>
                <button type="button" className="bill-back" onClick={() => onChoose("choose")}>
                  Back
                </button>
              </div>
            </form>
          ) : null}
          {mode === "upload" ? (
            <div className="bill-form">
              <label className="bill-field">
                <span>Bill file</span>
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
                  ? "Reading the file…"
                  : "Text PDF, CSV, or plain text. A scanned image can be typed in instead."}
              </p>
              <button type="button" className="bill-back" onClick={() => onChoose("choose")}>
                Back
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
