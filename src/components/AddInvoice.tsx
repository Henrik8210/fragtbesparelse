import { useId, useState, type FormEvent } from "react";
import { parseAmount } from "../bills/parse.ts";
import { readBillFile } from "../bills/read.ts";
import { useBills } from "../bills.tsx";
import { carrierProfiles, knownCarrier } from "../data/carriers.ts";

type Mode = "closed" | "choose" | "manual" | "upload";

export function AddInvoice({ customerId }: { customerId: string }) {
  const { addBill } = useBills(customerId);
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
      setErrors(["Choose the freight company."]);
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
      setErrors(["Enter the amount, for example 12.400 or 12400,50."]);
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
        const read = await readBillFile(file);
        addBill({ label: read.label, amount: read.amount, source: "file", carrier: chosen });
      } catch (error) {
        nextErrors.push(error instanceof Error ? error.message : "That file could not be read.");
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
        <button type="button" className="bill-pop-backdrop" aria-label="Close add invoice" onClick={close} />
      ) : null}
      <button
        type="button"
        className="invoice-add-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={formId}
        onClick={() => (open ? close() : setMode("choose"))}
      >
        Add an invoice
      </button>
      {open ? (
        <div
          className="bill-pop"
          id={formId}
          role="dialog"
          aria-label="Add an invoice"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <label className="bill-field">
            <span>Freight company</span>
            <select value={carrier} onChange={(event) => setCarrier(event.target.value)}>
              <option value="">Choose a carrier</option>
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
                Type the amount
              </button>
              <button type="button" className="bill-choice" onClick={() => setMode("upload")}>
                Upload a bill
              </button>
            </div>
          ) : null}
          {mode === "manual" ? (
            <form className="bill-form" onSubmit={addManual}>
              <label className="bill-field">
                <span>Description</span>
                <input name="label" type="text" maxLength={120} placeholder="Invoice number" autoFocus />
              </label>
              <label className="bill-field">
                <span>Amount</span>
                <input name="amount" type="text" inputMode="decimal" required placeholder="12.400" />
              </label>
              <div className="bill-actions">
                <button type="submit" className="bill-choice is-submit">
                  Add invoice
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
                  disabled={reading}
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void addFile(input.files).finally(() => {
                      input.value = "";
                    });
                  }}
                />
              </label>
              <p className="hint">Text PDF, CSV, or plain text. The file is read as a total for the carrier above.</p>
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
