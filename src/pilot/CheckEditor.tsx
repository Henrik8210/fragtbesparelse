import { useEffect, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, Sparkles } from "lucide-react";
import { ApiError } from "../api.ts";
import { fetchInvoiceCheck, saveInvoiceCheck, type CheckStore } from "./checkClient.ts";
import { loadCheckSource, type CheckSource } from "./checkSource.ts";
import {
  isFieldEdited, kronerText, lineProblems, lineSumOre, parseKroner, parseWeight,
  type CheckField, type CheckLine, type InvoiceCheck,
} from "./invoiceCheck.ts";
import { CONFIDENCE_LABELS, type LineKind } from "./invoiceExtract.ts";

type Draft = { kind: LineKind; shipment: string; reference: string; date: string; service: string; weight: string; amount: string; origin: string; destination: string };

const KIND_OPTIONS: { id: LineKind; label: string }[] = [
  { id: "shipment", label: "Forsendelse" },
  { id: "surcharge", label: "Tillæg" },
  { id: "fee", label: "Gebyr" },
  { id: "credit", label: "Kreditering" },
];

const toDraft = (line: CheckLine): Draft => ({
  kind: line.kind,
  shipment: line.shipment,
  reference: line.reference,
  date: line.date,
  service: line.service,
  weight: line.weightKg ? String(line.weightKg).replace(".", ",") : "",
  amount: kronerText(line.amountOre),
  origin: line.origin,
  destination: line.destination,
});

function fromDraft(draft: Draft): CheckLine | null {
  const weightKg = parseWeight(draft.weight);
  const amountOre = parseKroner(draft.amount);
  if (weightKg === null || amountOre === null) return null;
  return {
    kind: draft.kind,
    shipment: draft.shipment.trim(),
    reference: draft.reference.trim(),
    date: draft.date,
    service: draft.service.trim(),
    weightKg,
    amountOre,
    origin: draft.origin,
    destination: draft.destination,
  };
}

const sameDraft = (left: Draft, right: Draft) => (Object.keys(left) as (keyof Draft)[]).every((key) => left[key] === right[key]);

const stamp = (value: string) => new Intl.DateTimeFormat("da-DK", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen",
}).format(new Date(value));

const money = (ore: number) => `${kronerText(ore)} kr.`;

function originalText(line: CheckLine | undefined, field: CheckField): string {
  if (!line) return "ny linje";
  if (field === "amountOre") return money(line.amountOre);
  if (field === "weightKg") return line.weightKg ? `${String(line.weightKg).replace(".", ",")} kg` : "tom";
  if (field === "kind") return KIND_OPTIONS.find((item) => item.id === line.kind)?.label ?? line.kind;
  return String(line[field]) || "tom";
}

export function CheckEditor({ fileId, filename, companyId, carrier, onClose, onSaved }: {
  fileId: string;
  filename: string;
  companyId: string;
  carrier: string;
  onClose: () => void;
  onSaved: (check: InvoiceCheck, store: CheckStore) => void;
}) {
  const [state, setState] = useState<{ source: CheckSource; check: InvoiceCheck | null } | { error: string } | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [baseline, setBaseline] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let gone = false;
    Promise.all([loadCheckSource(fileId, filename, companyId), fetchInvoiceCheck(fileId, companyId)])
      .then(([source, check]) => {
        if (gone) return;
        const start = (check?.lines ?? source.lines).map(toDraft);
        setState({ source, check });
        setDrafts(start);
        setBaseline(start);
      })
      .catch((error: unknown) => {
        if (!gone) setState({ error: (error as Error).message || "Fakturaen kunne ikke læses." });
      });
    return () => { gone = true; };
  }, [fileId, filename, companyId]);

  const parsed = useMemo(() => drafts.map(fromDraft), [drafts]);
  const ready = state && "source" in state ? state : null;
  const original = ready ? ready.check?.original ?? ready.source.lines : [];
  const extract = ready?.source.extract ?? null;
  const dirty = drafts.length !== baseline.length || drafts.some((draft, index) => !sameDraft(draft, baseline[index]));
  const valid = parsed.every((line): line is CheckLine => line !== null);
  const lines = valid ? (parsed as CheckLine[]) : [];
  const problems = valid ? lineProblems(lines, extract?.invoiceDate ?? "") : ["Ret de markerede vægte og beløb."];
  const sum = lineSumOre(parsed.filter((line): line is CheckLine => line !== null));
  const target = extract ? (extract.subtotalOre ?? (extract.totalOre !== null && extract.vatOre !== null ? extract.totalOre - extract.vatOre : extract.totalOre)) : null;
  const editedCount = valid ? original.reduce((count, _line, index) => count + (["kind", "shipment", "reference", "date", "service", "weightKg", "amountOre"] as CheckField[])
    .filter((field) => isFieldEdited(original, lines, index, field)).length, 0) : 0;

  function edit(index: number, field: keyof Draft, value: string) {
    setDrafts((current) => current.map((draft, at) => at === index ? { ...draft, [field]: value } : draft));
  }

  async function confirm() {
    if (!ready || !valid || problems.length) return;
    setBusy(true);
    setProblem("");
    try {
      const saved = await saveInvoiceCheck(fileId, companyId, original, lines);
      onSaved(saved.check, saved.store);
    } catch (error) {
      setProblem(error instanceof ApiError && error.message !== error.code ? error.message : "Kontrollen blev ikke gemt. Prøv igen.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <p className="check-status" aria-busy="true"><Sparkles size={15} /> Læser fakturalinjerne…</p>;
  }
  if ("error" in state) {
    return <p className="check-status error" role="alert"><CircleAlert size={15} /> {state.error}</p>;
  }

  const meta = [
    extract?.carrier || carrier,
    extract?.invoiceNumber ? `Faktura ${extract.invoiceNumber}` : "",
    extract?.invoiceDate ? new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${extract.invoiceDate}T12:00:00Z`)) : "",
    filename,
  ].filter(Boolean).join(" · ");

  const cell = (index: number, field: CheckField) => {
    const edited = valid && isFieldEdited(original, lines, index, field);
    return {
      className: edited ? "edited" : undefined,
      title: edited ? `Oprindeligt: ${originalText(original[index], field)}` : undefined,
    };
  };

  return (
    <div className="check-editor">
      <div className="check-meta">
        <p>{meta}</p>
        <div className="check-chips">
          {extract ? <span className={`confidence ${extract.confidence}`}>{CONFIDENCE_LABELS[extract.confidence]}</span> : <span className="confidence high">Læst fra fil</span>}
          {state.check ? <span className="check-chip"><CircleCheck size={13} /> {state.check.checkedByName} · {stamp(state.check.checkedAt)}</span> : null}
        </div>
      </div>
      <div className="check-scroll">
        <table className="check-table">
          <thead>
            <tr>
              <th>#</th><th>Type</th><th>Forsendelse</th><th>Reference</th><th>Dato</th><th>Leveringsform</th><th className="num">Vægt kg</th><th className="num">Beløb kr.</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft, index) => (
              <tr key={index}>
                <td className="check-index">{index + 1}</td>
                <td {...cell(index, "kind")}>
                  <select value={draft.kind} aria-label={`Type, linje ${index + 1}`} onChange={(event) => edit(index, "kind", event.target.value)}>
                    {KIND_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </td>
                <td {...cell(index, "shipment")}><input value={draft.shipment} maxLength={96} aria-label={`Forsendelse, linje ${index + 1}`} onChange={(event) => edit(index, "shipment", event.target.value)} /></td>
                <td {...cell(index, "reference")}><input value={draft.reference} maxLength={96} aria-label={`Reference, linje ${index + 1}`} onChange={(event) => edit(index, "reference", event.target.value)} /></td>
                <td {...cell(index, "date")}>
                  <input type="date" value={draft.date} aria-label={`Dato, linje ${index + 1}`} onChange={(event) => edit(index, "date", event.target.value)} />
                </td>
                <td {...cell(index, "service")}><input value={draft.service} maxLength={64} aria-label={`Leveringsform, linje ${index + 1}`} onChange={(event) => edit(index, "service", event.target.value)} /></td>
                <td {...cell(index, "weightKg")}>
                  <input className={parseWeight(draft.weight) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.weight} aria-label={`Vægt, linje ${index + 1}`} onChange={(event) => edit(index, "weight", event.target.value)} />
                </td>
                <td {...cell(index, "amountOre")}>
                  <input className={parseKroner(draft.amount) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.amount} aria-label={`Beløb, linje ${index + 1}`} onChange={(event) => edit(index, "amount", event.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="check-foot">
        <div className="check-sums">
          <span>Linjesum <strong>{money(sum)}</strong></span>
          {target !== null ? (
            <span className={Math.abs(sum - target) <= 100 ? "match" : "mismatch"}>
              Faktura ekskl. moms <strong>{money(target)}</strong>
              {Math.abs(sum - target) <= 100 ? " · stemmer" : ` · afviger ${money(Math.abs(sum - target))}`}
            </span>
          ) : null}
          {editedCount ? <span className="check-edited">{editedCount} {editedCount === 1 ? "felt rettet" : "felter rettet"} · originalen gemmes</span> : null}
        </div>
        {problems.length ? <p className="check-problem" role="alert"><CircleAlert size={14} /> {problems[0]}</p> : null}
        {problem ? <p className="check-problem" role="alert"><CircleAlert size={14} /> {problem}</p> : null}
        <div className="check-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Annullér</button>
          <button type="button" className="button primary" onClick={() => void confirm()} disabled={busy || problems.length > 0}>
            {busy ? "Gemmer…" : dirty ? "Gem ændringer" : "Checked"}
          </button>
        </div>
      </div>
    </div>
  );
}
