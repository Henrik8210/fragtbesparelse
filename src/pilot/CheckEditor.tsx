import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, Sparkles } from "lucide-react";
import { ApiError } from "../api.ts";
import { fetchInvoiceCheck, saveInvoiceCheck, type CheckStore } from "./checkClient.ts";
import { loadCheckSource, type CheckSource } from "./checkSource.ts";
import {
  CHECK_FIELDS, checkIssues, isFieldEdited, kronerText, lineSumOre, parseKroner, parseWeight,
  type CheckField, type CheckLine, type InvoiceCheck,
} from "./invoiceCheck.ts";
import { SHIPMENT_MAX_KG } from "./freight.ts";
import { CONFIDENCE_LABELS, type LineKind } from "./invoiceExtract.ts";
import { nextIssue } from "./reviewIssues.ts";

type Draft = {
  kind: LineKind; shipment: string; reference: string; date: string; service: string; zone: string;
  weight: string; amount: string; origin: string; destination: string;
  quantity?: number; unit?: string; unitPriceOre?: number;
};

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
  zone: line.zone,
  weight: line.weightKg ? String(line.weightKg).replace(".", ",") : "",
  amount: kronerText(line.amountOre),
  origin: line.origin,
  destination: line.destination,
  quantity: line.quantity,
  unit: line.unit,
  unitPriceOre: line.unitPriceOre,
});

function fromDraft(draft: Draft): CheckLine | null {
  const weightKg = parseWeight(draft.weight, SHIPMENT_MAX_KG);
  const amountOre = parseKroner(draft.amount);
  if (weightKg === null || amountOre === null) return null;
  return {
    kind: draft.kind,
    shipment: draft.shipment.trim(),
    reference: draft.reference.trim(),
    date: draft.date,
    service: draft.service.trim(),
    zone: draft.zone.trim(),
    weightKg,
    amountOre,
    origin: draft.origin,
    destination: draft.destination,
    quantity: draft.quantity,
    unit: draft.unit,
    unitPriceOre: draft.unitPriceOre,
  };
}

const sameDraft = (left: Draft, right: Draft) => (Object.keys(left) as (keyof Draft)[]).every((key) => left[key] === right[key]);

const stamp = (value: string) => new Intl.DateTimeFormat("da-DK", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen",
}).format(new Date(value));

const money = (ore: number) => `${kronerText(ore)} kr.`;

const weightOf = (value: string) => parseWeight(value, SHIPMENT_MAX_KG);

/** One floating tooltip, outside the scroll area so the table does not clip it. */
function useFieldTip() {
  const [tip, setTip] = useState<{ text: string; left: number; top: number; below: boolean } | null>(null);
  const shown = useRef<Element | null>(null);
  const show = (target: EventTarget | null) => {
    const element = target instanceof Element ? target.closest("[data-tip]") : null;
    if (element === shown.current) return;
    shown.current = element;
    if (!element) return setTip(null);
    const rect = element.getBoundingClientRect();
    const below = rect.top < 90;
    setTip({ text: element.getAttribute("data-tip") ?? "", left: Math.min(Math.max(rect.left + rect.width / 2, 140), window.innerWidth - 140), top: below ? rect.bottom + 6 : rect.top - 6, below });
  };
  const node = tip ? createPortal(
    <div className={`review-tip${tip.below ? " below" : ""}`} role="tooltip" style={{ left: tip.left, top: tip.top }}>{tip.text}</div>,
    document.body,
  ) : null;
  return { show, hide: () => { shown.current = null; setTip(null); }, node };
}

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
  const [current, setCurrent] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState(0);
  const area = useRef<HTMLDivElement>(null);
  const order = useRef<string[]>([]);
  const tip = useFieldTip();

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
  const issues = checkIssues(drafts, extract?.invoiceDate ?? "");
  const issueByKey = useMemo(() => new Map(issues.map((issue) => [issue.key, issue])), [issues]);
  const sum = lineSumOre(parsed.filter((line): line is CheckLine => line !== null));
  const target = extract ? (extract.subtotalOre ?? (extract.totalOre !== null && extract.vatOre !== null ? extract.totalOre - extract.vatOre : extract.totalOre)) : null;
  const editedCount = valid ? original.reduce((count, _line, index) => count + CHECK_FIELDS
    .filter((field) => isFieldEdited(original, lines, index, field)).length, 0) : 0;

  function edit(index: number, field: keyof Draft, value: string) {
    setDrafts((current) => current.map((draft, at) => at === index ? { ...draft, [field]: value } : draft));
  }

  const currentIssue = current ? issueByKey.get(current) : undefined;
  const fixed = Boolean(current && !currentIssue);
  const position = currentIssue ? issues.indexOf(currentIssue) + 1 : 0;

  useEffect(() => {
    if (current && issueByKey.has(current)) order.current = issues.map((issue) => issue.key);
  }, [issues, issueByKey, current]);

  function go(step: 1 | -1) {
    const target = nextIssue(issues, current, step, order.current);
    setCurrent(target?.key ?? null);
    setScrollTo((count) => count + 1);
  }

  useEffect(() => {
    const root = area.current;
    if (!root) return;
    for (const element of root.querySelectorAll("[data-current]")) element.removeAttribute("data-current");
    if (!current) return;
    root.querySelector(`[data-issue="${CSS.escape(current)}"]`)?.setAttribute("data-current", "");
  });

  useEffect(() => {
    if (!scrollTo || !current) return;
    const element = area.current?.querySelector(`[data-issue="${CSS.escape(current)}"]`);
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    const input = element.matches("input, select") ? element as HTMLElement : element.querySelector<HTMLElement>("input, select");
    input?.focus({ preventScroll: true });
  }, [scrollTo]); // eslint-disable-line react-hooks/exhaustive-deps

  function onFocusIn(event: React.FocusEvent) {
    const key = (event.target as Element).closest("[data-issue]")?.getAttribute("data-issue");
    if (key && key !== current) setCurrent(key);
  }

  function onFocusOut(event: React.FocusEvent) {
    if (!fixed) return;
    const next = event.relatedTarget as Element | null;
    if (next && (next.closest(".review-nav") || next.closest("[data-issue]") || next.matches("input, select"))) return;
    go(1);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
    if (!fixed && currentIssue) return;
    event.preventDefault();
    go(1);
  }

  async function confirm() {
    if (!ready || !valid || issues.length) {
      if (issues[0]) go(1);
      return;
    }
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

  const mark = (index: number, field: CheckField, issueField: string) => {
    const issue = issueByKey.get(`line:${index}:${issueField}`);
    const edited = cell(index, field);
    return {
      ...edited,
      className: [edited.className, issue ? "issue-blocking" : ""].filter(Boolean).join(" ") || undefined,
      "data-issue": issue?.key,
      "data-tip": issue?.message,
    };
  };

  return (
    <div
      className="check-editor"
      ref={area}
      onFocus={onFocusIn}
      onBlur={onFocusOut}
      onKeyDown={onKeyDown}
      onMouseOver={(event) => tip.show(event.target)}
      onMouseLeave={tip.hide}
      onScroll={tip.hide}
    >
      {tip.node}
      <div className="check-meta">
        <p>{meta}</p>
        <div className="check-chips">
          {extract ? <span className={`confidence ${extract.confidence}`}>{CONFIDENCE_LABELS[extract.confidence]}</span> : <span className="confidence high">Læst fra fil</span>}
          {state.check ? <span className="check-chip"><CircleCheck size={13} /> {state.check.checkedByName} · {stamp(state.check.checkedAt)}</span> : null}
        </div>
      </div>
      <div className={`review-nav${issues.length ? "" : " done"}`} role="status" aria-live="polite">
        {issues.length ? (
          <>
            <span className="check-chip warn"><CircleAlert size={13} /> {issues.length} at tjekke · {issues.length} skal rettes</span>
            <p>
              {currentIssue ? <><strong>{position} af {issues.length} · {currentIssue.where}:</strong> {currentIssue.message}</>
                : fixed ? <><CircleCheck size={13} /> Rettet. Gå videre til næste punkt.</>
                  : "Hold musen over et markeret felt for at se, hvad der er galt."}
            </p>
            <div className="review-nav-actions">
              <button type="button" className="text-button" onClick={() => go(-1)} aria-label="Forrige punkt"><ChevronUp size={14} /> Forrige</button>
              <button type="button" className="button primary small" onClick={() => go(1)}>{current ? "Næste" : "Gå til første"} <ChevronDown size={14} /></button>
            </div>
          </>
        ) : <p><CircleCheck size={13} /> Ingen felter skal rettes. Kontrollen kan gemmes.</p>}
      </div>
      <div className="check-scroll">
        <table className="check-table">
          <thead>
            <tr>
              <th>#</th><th>Type</th><th>Forsendelse</th><th>Reference</th><th>Dato</th><th>Leveringsform</th><th>Rute</th><th className="num">Vægt kg</th><th className="num">Beløb kr.</th>
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
                <td {...mark(index, "date", "date")}>
                  <input type="date" value={draft.date} aria-label={`Dato, linje ${index + 1}`} onChange={(event) => edit(index, "date", event.target.value)} />
                  {!draft.date && extract?.invoiceDate ? <small className="check-hint">Fakturadato bruges</small> : null}
                </td>
                <td {...mark(index, "service", "service")}><input value={draft.service} maxLength={64} aria-label={`Leveringsform, linje ${index + 1}`} onChange={(event) => edit(index, "service", event.target.value)} /></td>
                <td {...cell(index, "zone")}><input value={draft.zone} maxLength={40} aria-label={`Rute, linje ${index + 1}`} onChange={(event) => edit(index, "zone", event.target.value)} /></td>
                <td {...mark(index, "weightKg", "weight")}>
                  <input className={weightOf(draft.weight) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.weight} aria-label={`Vægt, linje ${index + 1}`} onChange={(event) => edit(index, "weight", event.target.value)} />
                </td>
                <td {...mark(index, "amountOre", "amount")}>
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
        {problem ? <p className="check-problem" role="alert"><CircleAlert size={14} /> {problem}</p> : null}
        <div className="check-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Annullér</button>
          <button type="button" className="button primary" onClick={() => void confirm()} disabled={busy || issues.length > 0}>
            {busy ? "Gemmer…" : dirty ? "Gem ændringer" : "Checked"}
          </button>
        </div>
      </div>
    </div>
  );
}
