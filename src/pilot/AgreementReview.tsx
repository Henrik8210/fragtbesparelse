import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronUp, CircleAlert, CircleCheck, Plus, Trash2 } from "lucide-react";
import { ApiError } from "../api.ts";
import { agreementFromRows, type Agreement } from "./agreements.ts";
import {
  decimalText, parseDecimal, SURCHARGE_KINDS, UNIT_SUGGESTIONS,
  type AgreementTerms, type PriceGrid, type SurchargeKind,
} from "./agreementFormat.ts";
import { agreementRatesToRows, type AgreementExtract, type AgreementRate, type ExtractGrid } from "./agreementExtract.ts";
import { kronerText, parseKroner, parseWeight } from "./invoiceCheck.ts";
import { fromRate, parsePct, RATE_FIELD_LABELS, rateProblem, rateProblemText, type RateDraft, type RateField } from "./rateDraft.ts";
import { CONFIDENCE_LABELS } from "./invoiceExtract.ts";
import { agreementName } from "./agreementAuto.ts";
import {
  acceptIssue, canAccept, nextIssue, reviewIssues,
  type ConditionDraft, type GridDraft, type ItemDraft, type ReviewDrafts, type ReviewIssue, type SurchargeDraft,
} from "./reviewIssues.ts";

/** Props that mark a row or cell as an issue: the key the navigator scrolls to and the text the tooltip shows. */
function issueProps(issue: ReviewIssue | undefined, base?: string) {
  if (!issue) return base ? { className: base } : {};
  return {
    className: [base, issue.blocking ? "issue-blocking" : "issue-flag"].filter(Boolean).join(" "),
    "data-issue": issue.key,
    "data-tip": issue.message,
  };
}

/** One floating tooltip for the review, outside the scroll area so it is never clipped. */
function useReviewTip() {
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
  const hide = () => {
    shown.current = null;
    setTip(null);
  };
  const node = tip ? createPortal(
    <div className={`review-tip${tip.below ? " below" : ""}`} role="tooltip" style={{ left: tip.left, top: tip.top }}>{tip.text}</div>,
    document.body,
  ) : null;
  return { show, hide, node };
}

const KIND_LABELS: Record<SurchargeKind, string> = { percent: "Procent", amount: "Beløb", agreed: "Skal aftales" };

const toRate = (rate: AgreementRate): RateDraft => ({
  service: rate.service,
  zone: rate.zone,
  weight: rate.maxWeight ? String(rate.maxWeight).replace(".", ",") : "",
  base: rate.baseOre ? kronerText(rate.baseOre) : "",
  fuel: rate.fuelPct ? String(rate.fuelPct).replace(".", ",") : "",
  fixed: rate.fixedOre ? kronerText(rate.fixedOre) : "",
  issues: rate.issues,
});

const toGrid = (grid: ExtractGrid): GridDraft => ({
  ...grid,
  columns: grid.columns.map((column) => ({ ...column })),
  rows: grid.rows.map((row) => ({ label: row.label, cells: row.cells.map((value) => decimalText(value)) })),
  minimum: grid.minimum.map((value) => decimalText(value)),
  maximum: grid.maximum.map((value) => decimalText(value)),
});

const bad = (value: string) => parseDecimal(value) === undefined;
const filled = (values: string[]) => values.some((value) => value.trim());

/** The reviewed drafts as stored terms, or a Danish message naming the first value that does not read as a number. */
function toTerms(items: ItemDraft[], grids: GridDraft[], surcharges: SurchargeDraft[], conditions: ConditionDraft[]): AgreementTerms | string {
  const outItems: AgreementTerms["items"] = [];
  for (const [index, item] of items.entries()) {
    if (!item.description.trim()) return `Pris ${index + 1} mangler en beskrivelse.`;
    const price = parseDecimal(item.price);
    if (price === undefined) return `Pris ${index + 1} (${item.description}) er ikke et tal.`;
    outItems.push({ category: item.category.trim(), description: item.description.trim(), unit: item.unit.trim(), price, currency: item.currency.trim(), note: item.note.trim() });
  }
  const outGrids: PriceGrid[] = [];
  for (const grid of grids) {
    const name = grid.name.trim() || "Prisgitter";
    if (!grid.columns.length || !grid.rows.length) return `${name} skal have mindst én kolonne og én række.`;
    const numbers = (values: string[], what: string): (number | null)[] | string => {
      const out: (number | null)[] = [];
      for (const [column, value] of values.entries()) {
        const parsed = parseDecimal(value);
        if (parsed === undefined) return `${name}, ${what}, ${grid.columns[column]?.label || `kolonne ${column + 1}`}: «${value}» er ikke et tal.`;
        out.push(parsed);
      }
      return out;
    };
    const rows: PriceGrid["rows"] = [];
    for (const [index, row] of grid.rows.entries()) {
      const cells = numbers(row.cells, row.label || `række ${index + 1}`);
      if (typeof cells === "string") return cells;
      rows.push({ label: row.label.trim() || `Række ${index + 1}`, cells });
    }
    const minimum = filled(grid.minimum) ? numbers(grid.minimum, "minimum") : [];
    if (typeof minimum === "string") return minimum;
    const maximum = filled(grid.maximum) ? numbers(grid.maximum, "maksimum") : [];
    if (typeof maximum === "string") return maximum;
    outGrids.push({
      name, category: grid.category.trim(), unit: grid.unit.trim(), currency: grid.currency.trim(), rowLabel: grid.rowLabel.trim(), note: grid.note.trim(),
      columns: grid.columns.map((column) => ({ label: column.label.trim(), detail: column.detail.trim() })),
      rows, minimum, maximum,
    });
  }
  const outSurcharges: AgreementTerms["surcharges"] = [];
  for (const [index, item] of surcharges.entries()) {
    if (!item.label.trim()) return `Tillæg ${index + 1} mangler et navn.`;
    const value = item.kind === "agreed" ? null : parseDecimal(item.value);
    if (value === undefined || (item.kind !== "agreed" && value === null)) return `Tillæg ${index + 1} (${item.label}) skal have en værdi, eller vælg «Skal aftales».`;
    outSurcharges.push({ label: item.label.trim(), kind: item.kind, value, unit: item.unit.trim(), scope: item.scope.trim(), note: item.note.trim() });
  }
  return { items: outItems, grids: outGrids, surcharges: outSurcharges, conditions: conditions.map((item) => item.text.trim()).filter(Boolean) };
}

const BLANK_RATE: RateDraft = { service: "", zone: "", weight: "", base: "", fuel: "", fixed: "", issues: [] };

export function AgreementReview({ extract, reasons = [], orgId, carriers, onBack, onSave }: {
  extract: AgreementExtract;
  reasons?: string[];
  orgId: string;
  carriers: string[];
  onBack: () => void;
  onSave: (agreement: Agreement) => Promise<void>;
}) {
  const [rates, setRates] = useState<RateDraft[]>(() => extract.rates.map(toRate));
  const [items, setItems] = useState<ItemDraft[]>(() => extract.items.map((item) => ({ ...item, price: decimalText(item.price) })));
  const [grids, setGrids] = useState<GridDraft[]>(() => extract.grids.map(toGrid));
  const [surcharges, setSurcharges] = useState<SurchargeDraft[]>(() => extract.surcharges.map((item) => ({ ...item, value: decimalText(item.value, item.kind === "percent" ? "percent" : "money") })));
  const [conditions, setConditions] = useState<ConditionDraft[]>(() => extract.conditions.map((item) => ({ ...item })));
  const [carrier, setCarrier] = useState(extract.carrier);
  const [from, setFrom] = useState(extract.validFrom);
  const [to, setTo] = useState(extract.validTo);
  const [problem, setProblem] = useState("");
  const [focusRate, setFocusRate] = useState<{ index: number; field: RateField } | null>(null);
  const rateInputs = useRef(new Map<string, HTMLInputElement>());
  const [saving, setSaving] = useState(false);
  const name = agreementName(carrier, from, to);

  const parsedRates = useMemo(() => rates.map(fromRate), [rates]);
  const drafts: ReviewDrafts = { carrier, from, to, rates, items, grids, surcharges, conditions };
  const issues = useMemo(
    () => reviewIssues({ carrier, from, to, rates, items, grids, surcharges, conditions }),
    [carrier, from, to, rates, items, grids, surcharges, conditions],
  );
  const issueByKey = useMemo(() => new Map(issues.map((issue) => [issue.key, issue])), [issues]);
  const [current, setCurrent] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState(0);
  const order = useRef<string[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const tip = useReviewTip();
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

  function goTo(key: string) {
    setCurrent(key);
    setScrollTo((count) => count + 1);
  }

  function accept() {
    if (!currentIssue || !canAccept(currentIssue)) return;
    const patch = acceptIssue(drafts, currentIssue.key);
    if (patch.rates) setRates(patch.rates);
    if (patch.items) setItems(patch.items);
    if (patch.grids) setGrids(patch.grids);
    if (patch.surcharges) setSurcharges(patch.surcharges);
    if (patch.conditions) setConditions(patch.conditions);
    const rest = issues.filter((issue) => issue.key !== currentIssue.key);
    const target = nextIssue(rest, currentIssue.key, 1, issues.map((issue) => issue.key));
    setCurrent(target?.key ?? null);
    setScrollTo((count) => count + 1);
  }

  useEffect(() => {
    const root = area.current;
    if (!root) return;
    for (const element of root.querySelectorAll("[data-current]")) element.removeAttribute("data-current");
    if (!current) return;
    const element = root.querySelector(`[data-issue="${CSS.escape(current)}"]`);
    element?.setAttribute("data-current", "");
  });

  useEffect(() => {
    if (!scrollTo || !current) return;
    const element = area.current?.querySelector(`[data-issue="${CSS.escape(current)}"]`);
    if (!element) return;
    const details = element.closest("details");
    if (details && !details.open) details.open = true;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    const input = element.matches("input, textarea, select") ? element as HTMLElement : element.querySelector<HTMLElement>("input:not(:disabled), textarea, select");
    input?.focus({ preventScroll: true });
  }, [scrollTo]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Clicking into a flagged field makes it the current issue, without scrolling. */
  function onFocusIn(event: React.FocusEvent) {
    const key = (event.target as Element).closest("[data-issue]")?.getAttribute("data-issue");
    if (key && key !== current) setCurrent(key);
  }

  /** After the current issue is fixed, leaving the field or pressing Enter moves on to the next one. */
  function onFocusOut(event: React.FocusEvent) {
    if (!fixed) return;
    const next = event.relatedTarget as Element | null;
    if (next && (next.closest(".review-nav") || next.closest("[data-issue]") || next.matches("input, textarea, select"))) return;
    go(1);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    if (fixed || (currentIssue && !currentIssue.blocking)) {
      if (currentIssue && canAccept(currentIssue)) accept();
      else go(1);
    }
  }
  const cellCount = grids.reduce((sum, grid) => sum + grid.rows.length * grid.columns.length, 0);
  const counts = [
    rates.length ? `${rates.length} pakkepriser` : "",
    items.length ? `${items.length} priser` : "",
    grids.length ? `${grids.length} prisgitre (${cellCount} felter)` : "",
    surcharges.length ? `${surcharges.length} tillæg` : "",
    conditions.length ? `${conditions.length} betingelser` : "",
  ].filter(Boolean);
  const empty = !rates.length && !items.length && !grids.length && !surcharges.length;

  function editRate(index: number, field: keyof Omit<RateDraft, "issues">, value: string) {
    setRates((current) => current.map((draft, at) => at === index ? { ...draft, [field]: value, issues: [] } : draft));
  }
  function editItem(index: number, field: keyof Omit<ItemDraft, "issues">, value: string) {
    setItems((current) => current.map((item, at) => at === index ? { ...item, [field]: value, issues: field === "price" ? [] : item.issues } : item));
  }
  function editSurcharge(index: number, patch: Partial<SurchargeDraft>) {
    setSurcharges((current) => current.map((item, at) => at === index ? { ...item, ...patch, issues: [] } : item));
  }
  function editGrid(index: number, change: (grid: GridDraft) => GridDraft) {
    setGrids((current) => current.map((grid, at) => at === index ? change(grid) : grid));
  }

  async function save() {
    setProblem("");
    const blocking = issues.find((issue) => issue.blocking);
    if (blocking) {
      setProblem(`${blocking.where}: ${blocking.message}`);
      goTo(blocking.key);
      return;
    }
    const badRate = parsedRates.findIndex((rate) => rate === null);
    if (badRate >= 0) {
      const found = rateProblem(rates[badRate]);
      if (found) {
        setProblem(rateProblemText(rates[badRate], badRate, found));
        setFocusRate({ index: badRate, field: found.field });
        return;
      }
    }
    if (from && to && to < from) {
      setProblem("Slutdatoen skal ligge på eller efter startdatoen.");
      return;
    }
    const terms = toTerms(items, grids, surcharges, conditions);
    if (typeof terms === "string") {
      setProblem(terms);
      return;
    }
    let agreement: Agreement;
    try {
      const rows = agreementRatesToRows(parsedRates as Omit<AgreementRate, "issues">[], from, to);
      agreement = agreementFromRows(rows, { orgId, name, carrier, from, to }, new Date(), terms);
    } catch (error) {
      setProblem((error as Error).message);
      return;
    }
    setSaving(true);
    try {
      await onSave(agreement);
    } catch (error) {
      setProblem(error instanceof ApiError && error.message !== error.code ? error.message : "Prisaftalen blev ikke gemt. Prøv igen.");
      setSaving(false);
    }
  }

  const bindRate = (index: number, field: RateField) => (input: HTMLInputElement | null) => {
    if (input) rateInputs.current.set(`${index}:${field}`, input);
    else rateInputs.current.delete(`${index}:${field}`);
  };

  useEffect(() => {
    if (!focusRate) return;
    const input = rateInputs.current.get(`${focusRate.index}:${focusRate.field}`);
    input?.scrollIntoView({ block: "center" });
    input?.focus();
  }, [focusRate]);

  const coverage = extract.coverage.printed ? Math.round((extract.coverage.captured / extract.coverage.printed) * 100) : null;

  const blockingCount = issues.filter((issue) => issue.blocking).length;

  return (
    <div
      className="check-editor agreement-review"
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
        <p>{[extract.carrier, extract.filename, counts.join(", ") || "ingen priser læst"].filter(Boolean).join(" · ")}</p>
        <div className="check-chips">
          <span className={`confidence ${extract.confidence}`}>{CONFIDENCE_LABELS[extract.confidence]}</span>
          {coverage !== null ? <span className="check-chip" data-tip="Priser med decimaler i PDF'ens tekst, som udtrækket indeholder">{extract.coverage.captured} af {extract.coverage.printed} priser fundet ({coverage} %)</span> : null}
        </div>
      </div>
      <div className="review-fields">
        <label {...issueProps(issueByKey.get("carrier"))}>Transportør<input value={carrier} onChange={(event) => setCarrier(event.target.value)} maxLength={70} list="review-carriers" placeholder="Transportørens navn" /></label>
        <datalist id="review-carriers">{carriers.map((item) => <option key={item} value={item} />)}</datalist>
        <label {...issueProps(issueByKey.get("from"))}>Gyldig fra<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label {...issueProps(issueByKey.get("to"))}>Gyldig til<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <p className="review-name">Navn: <strong>{name}</strong></p>
      {reasons.length ? (
        <div className="check-problem" role="status">
          <CircleAlert size={14} />
          <div><strong>Tjek før aftalen gemmes:</strong> {reasons.join(" ")}</div>
        </div>
      ) : null}
      <datalist id="review-units">{UNIT_SUGGESTIONS.map((unit) => <option key={unit} value={unit} />)}</datalist>
      {!reasons.length && extract.issues.length ? <p className="check-problem" role="status"><CircleAlert size={14} /> {extract.issues.join(" ")}</p> : null}
      <div className={`review-nav${issues.length ? "" : " done"}`} role="status" aria-live="polite">
        {issues.length ? (
          <>
            <span className="check-chip warn"><CircleAlert size={13} /> {issues.length} at tjekke{blockingCount ? ` · ${blockingCount} skal rettes` : ""}</span>
            <p>
              {currentIssue ? <><strong>{position} af {issues.length} · {currentIssue.where}:</strong> {currentIssue.message}</>
                : fixed ? <><CircleCheck size={13} /> Rettet. Gå videre til næste punkt.</>
                  : "Gult står ikke ordret i PDF'en og kan gemmes. Rødt skal rettes. Hold musen over et felt for at se, hvad der er galt."}
            </p>
            <div className="review-nav-actions">
              <button type="button" className="text-button" onClick={() => go(-1)} aria-label="Forrige punkt"><ChevronUp size={14} /> Forrige</button>
              {currentIssue && canAccept(currentIssue)
                ? <button type="button" className="button secondary small" onClick={accept} data-tip="Fjern markeringen og gå til næste punkt"><Check size={14} /> Ser rigtigt ud</button>
                : null}
              <button type="button" className="button primary small" onClick={() => go(1)}>{current ? "Næste" : "Gå til første"} <ChevronDown size={14} /></button>
            </div>
          </>
        ) : <p><CircleCheck size={13} /> {reasons.length ? "Ingen felter er markeret. Tjek punkterne ovenfor, og gem aftalen." : "Alle punkter er gennemgået. Aftalen kan gemmes."}</p>}
      </div>

      <div className="check-scroll review-sections">
        {rates.length ? (
          <section className="review-section">
            <h3>Pakkepriser <small>{rates.length} · bruges i Nyt fakturatjek</small></h3>
            <table className="check-table">
              <thead>
                <tr>
                  <th>#</th><th>Leveringsform</th><th>Zone</th><th className="num">Maks. kg</th><th className="num">Grundpris kr.</th><th className="num">Brændstof %</th><th className="num">Fast tillæg kr.</th><th aria-label="Fjern" />
                </tr>
              </thead>
              <tbody>
                {rates.map((draft, index) => {
                  const flag = draft.issues.length ? { className: "edited" } : {};
                  const issue = issueByKey.get(`rate:${index}`);
                  return (
                    <tr key={index} {...issueProps(issue)}>
                      <td className="check-index">{index + 1}{issue ? <CircleAlert size={12} className="review-flag" /> : null}</td>
                      <td {...flag}><input className={draft.service.trim() ? undefined : "invalid"} value={draft.service} maxLength={64} ref={bindRate(index, "service")} aria-label={`${RATE_FIELD_LABELS.service}, række ${index + 1}`} onChange={(event) => editRate(index, "service", event.target.value)} /></td>
                      <td {...flag}><input value={draft.zone} maxLength={40} aria-label={`Zone, række ${index + 1}`} onChange={(event) => editRate(index, "zone", event.target.value)} /></td>
                      <td {...flag}><input className={parseWeight(draft.weight) ? "num" : "num invalid"} inputMode="decimal" value={draft.weight} ref={bindRate(index, "weight")} aria-label={`${RATE_FIELD_LABELS.weight}, række ${index + 1}`} onChange={(event) => editRate(index, "weight", event.target.value)} /></td>
                      <td {...flag}><input className={parseKroner(draft.base) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.base} ref={bindRate(index, "base")} aria-label={`${RATE_FIELD_LABELS.base}, række ${index + 1}`} onChange={(event) => editRate(index, "base", event.target.value)} /></td>
                      <td {...flag}><input className={parsePct(draft.fuel) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.fuel} ref={bindRate(index, "fuel")} aria-label={`${RATE_FIELD_LABELS.fuel}, række ${index + 1}`} onChange={(event) => editRate(index, "fuel", event.target.value)} /></td>
                      <td {...flag}><input className={draft.fixed.trim() && parseKroner(draft.fixed) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.fixed} ref={bindRate(index, "fixed")} aria-label={`${RATE_FIELD_LABELS.fixed}, række ${index + 1}`} onChange={(event) => editRate(index, "fixed", event.target.value)} /></td>
                      <td><button type="button" className="icon-button" aria-label={`Fjern pakkepris ${index + 1}`} onClick={() => setRates((current) => current.filter((_, at) => at !== index))}><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button type="button" className="text-button" onClick={() => setRates((current) => [...current, { ...BLANK_RATE }])}><Plus size={14} /> Tilføj pakkepris</button>
          </section>
        ) : null}

        <section className="review-section">
          <h3>Priser <small>{items.length}</small></h3>
          {items.length ? (
            <table className="check-table">
              <thead>
                <tr><th>#</th><th>Kategori</th><th>Beskrivelse</th><th>Enhed</th><th className="num">Pris</th><th>Valuta</th><th>Note</th><th aria-label="Fjern" /></tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={index} {...issueProps(issueByKey.get(`item:${index}`))}>
                    <td className="check-index">{index + 1}{issueByKey.has(`item:${index}`) ? <CircleAlert size={12} className="review-flag" /> : null}</td>
                    <td><input value={item.category} maxLength={80} aria-label={`Kategori, pris ${index + 1}`} onChange={(event) => editItem(index, "category", event.target.value)} /></td>
                    <td><input className={item.description.trim() ? undefined : "invalid"} value={item.description} maxLength={200} aria-label={`Beskrivelse, pris ${index + 1}`} onChange={(event) => editItem(index, "description", event.target.value)} /></td>
                    <td><input value={item.unit} maxLength={60} list="review-units" aria-label={`Enhed, pris ${index + 1}`} onChange={(event) => editItem(index, "unit", event.target.value)} /></td>
                    <td className={item.issues.length ? "edited" : undefined}><input className={bad(item.price) ? "num invalid" : "num"} inputMode="decimal" value={item.price} aria-label={`Pris ${index + 1}`} onChange={(event) => editItem(index, "price", event.target.value)} /></td>
                    <td><input className="short" value={item.currency} maxLength={8} aria-label={`Valuta, pris ${index + 1}`} onChange={(event) => editItem(index, "currency", event.target.value)} /></td>
                    <td><input value={item.note} maxLength={300} aria-label={`Note, pris ${index + 1}`} onChange={(event) => editItem(index, "note", event.target.value)} /></td>
                    <td><button type="button" className="icon-button" aria-label={`Fjern pris ${index + 1}`} onClick={() => setItems((current) => current.filter((_, at) => at !== index))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <button type="button" className="text-button" onClick={() => setItems((current) => [...current, { category: "", description: "", unit: "", price: "", currency: extract.currency, note: "", issues: [] }])}><Plus size={14} /> Tilføj pris</button>
        </section>

        <section className="review-section">
          <h3>Prisgitre <small>{grids.length}</small></h3>
          {grids.map((grid, gridIndex) => (
            <GridEditor
              key={gridIndex}
              grid={grid}
              issueAt={(key) => issueByKey.get(`grid:${gridIndex}${key ? `:${key}` : ""}`)}
              onChange={(change) => editGrid(gridIndex, change)}
              onRemove={() => setGrids((current) => current.filter((_, at) => at !== gridIndex))}
            />
          ))}
        </section>

        <section className="review-section">
          <h3>Tillæg <small>{surcharges.length}</small></h3>
          {surcharges.length ? (
            <table className="check-table">
              <thead>
                <tr><th>#</th><th>Tillæg</th><th>Type</th><th className="num">Værdi</th><th>Enhed</th><th>Gælder for</th><th>Note</th><th aria-label="Fjern" /></tr>
              </thead>
              <tbody>
                {surcharges.map((item, index) => (
                  <tr key={index} {...issueProps(issueByKey.get(`surcharge:${index}`))}>
                    <td className="check-index">{index + 1}{issueByKey.has(`surcharge:${index}`) ? <CircleAlert size={12} className="review-flag" /> : null}</td>
                    <td><input className={item.label.trim() ? undefined : "invalid"} value={item.label} maxLength={120} aria-label={`Tillæg ${index + 1}`} onChange={(event) => editSurcharge(index, { label: event.target.value })} /></td>
                    <td>
                      <select value={item.kind} aria-label={`Type, tillæg ${index + 1}`} onChange={(event) => editSurcharge(index, { kind: event.target.value as SurchargeKind, ...(event.target.value === "agreed" ? { value: "" } : {}) })}>
                        {SURCHARGE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                      </select>
                    </td>
                    <td className={item.issues.length ? "edited" : undefined}>
                      <input
                        className={item.kind !== "agreed" && (bad(item.value) || !item.value.trim()) ? "num invalid" : "num"}
                        inputMode="decimal"
                        value={item.value}
                        disabled={item.kind === "agreed"}
                        placeholder={item.kind === "agreed" ? "Aftales" : item.kind === "percent" ? "%" : "kr."}
                        aria-label={`Værdi, tillæg ${index + 1}`}
                        onChange={(event) => editSurcharge(index, { value: event.target.value })}
                      />
                    </td>
                    <td><input value={item.unit} maxLength={60} list="review-units" aria-label={`Enhed, tillæg ${index + 1}`} onChange={(event) => editSurcharge(index, { unit: event.target.value })} /></td>
                    <td><input value={item.scope} maxLength={200} aria-label={`Gælder for, tillæg ${index + 1}`} onChange={(event) => editSurcharge(index, { scope: event.target.value })} /></td>
                    <td><input value={item.note} maxLength={300} aria-label={`Note, tillæg ${index + 1}`} onChange={(event) => editSurcharge(index, { note: event.target.value })} /></td>
                    <td><button type="button" className="icon-button" aria-label={`Fjern tillæg ${index + 1}`} onClick={() => setSurcharges((current) => current.filter((_, at) => at !== index))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <button type="button" className="text-button" onClick={() => setSurcharges((current) => [...current, { label: "", kind: "percent", value: "", unit: "", scope: "", note: "", issues: [] }])}><Plus size={14} /> Tilføj tillæg</button>
        </section>

        <section className="review-section">
          <h3>Betingelser <small>{conditions.length}</small></h3>
          <ol className="review-conditions">
            {conditions.map((item, index) => (
              <li key={index} {...issueProps(issueByKey.get(`condition:${index}`), item.printed ? undefined : "edited")}>
                <textarea
                  value={item.text}
                  maxLength={1000}
                  rows={Math.min(4, Math.max(1, Math.ceil(item.text.length / 110)))}
                  aria-label={`Betingelse ${index + 1}`}
                  onChange={(event) => setConditions((current) => current.map((condition, at) => at === index ? { text: event.target.value, printed: true } : condition))}
                />
                <button type="button" className="icon-button" aria-label={`Fjern betingelse ${index + 1}`} onClick={() => setConditions((current) => current.filter((_, at) => at !== index))}><Trash2 size={14} /></button>
              </li>
            ))}
          </ol>
          <button type="button" className="text-button" onClick={() => setConditions((current) => [...current, { text: "", printed: true }])}><Plus size={14} /> Tilføj betingelse</button>
        </section>
      </div>

      <div className="check-foot">
        <div className="check-sums">
          {rates.length ? <span>En zone lægges sammen med leveringsformen, fx «Pakkeshop Zone 2». Kun pakkepriser bruges i fakturatjekket.</span>
            : <span>Aftalen har ingen pakkepriser, så den vises under Prisaftaler, men kan ikke vælges i Nyt fakturatjek endnu.</span>}
        </div>
        {problem ? <p className="check-problem" role="alert"><CircleAlert size={14} /> {problem}</p> : null}
        <div className="check-actions">
          <button type="button" className="button secondary" onClick={onBack} disabled={saving}>Tilbage</button>
          <button type="button" className="button primary" onClick={() => void save()} disabled={empty || saving}>{saving ? "Gemmer…" : "Gem prisaftale"}</button>
        </div>
      </div>
    </div>
  );
}

/** Flag keys after a grid row is removed: that row's flags go, later rows move up one. */
function shiftRows(keys: string[], removed: number): string[] {
  return keys.flatMap((key) => {
    const [row, column] = key.split(":");
    if (row === "min" || row === "max") return [key];
    const index = Number(row);
    if (index === removed) return [];
    return [index > removed ? `${index - 1}:${column}` : key];
  });
}

function GridEditor({ grid, issueAt, onChange, onRemove }: {
  grid: GridDraft;
  /** The issue on a cell ("row:column", "min:column", "max:column"), or on the whole grid for "". */
  issueAt: (key: string) => ReviewIssue | undefined;
  onChange: (change: (grid: GridDraft) => GridDraft) => void;
  onRemove: () => void;
}) {
  const clear = (key: string) => grid.unprinted.filter((item) => item !== key);
  const setCell = (row: number, column: number, value: string) => onChange((current) => ({
    ...current,
    rows: current.rows.map((line, at) => at === row ? { ...line, cells: line.cells.map((cell, index) => index === column ? value : cell) } : line),
    unprinted: clear(`${row}:${column}`),
  }));
  const setLimit = (which: "minimum" | "maximum", column: number, value: string) => onChange((current) => {
    const line = current[which].length ? [...current[which]] : current.columns.map(() => "");
    line[column] = value;
    return { ...current, [which]: line, unprinted: clear(`${which === "minimum" ? "min" : "max"}:${column}`) };
  });
  const cellClass = (value: string) => bad(value) ? "num invalid" : "num";
  const flagged = (key: string) => {
    const issue = issueAt(key);
    return issueProps(issue, issue && !issue.blocking ? "edited" : undefined);
  };
  // Opened once for a flagged grid; accepting its last flag must not fold it away under the reader.
  const [open] = useState(() => grid.issues.length > 0 || grid.unprinted.length > 0);
  const field = (key: "name" | "category" | "unit" | "currency" | "rowLabel" | "note") =>
    (event: { target: { value: string } }) => onChange((current) => ({ ...current, [key]: event.target.value }));

  return (
    <details {...issueProps(issueAt(""), "review-grid")} open={open}>
      <summary>
        <strong>{grid.name || "Prisgitter"}</strong>
        <small>{[grid.category, grid.unit, `${grid.rows.length} × ${grid.columns.length}`].filter(Boolean).join(" · ")}</small>
        {grid.unprinted.length ? <span className="check-chip warn"><CircleAlert size={13} /> {grid.unprinted.length}</span> : null}
      </summary>
      <div className="review-fields grid-fields">
        <label>Navn<input value={grid.name} maxLength={160} onChange={field("name")} /></label>
        <label>Kategori<input value={grid.category} maxLength={80} onChange={field("category")} /></label>
        <label>Enhed<input value={grid.unit} maxLength={60} list="review-units" onChange={field("unit")} /></label>
        <label>Valuta<input value={grid.currency} maxLength={8} onChange={field("currency")} /></label>
        <label>Note<input value={grid.note} maxLength={300} onChange={field("note")} /></label>
      </div>
      {grid.issues.length ? <p className="check-problem" role="status"><CircleAlert size={14} /> {grid.issues.join(" ")}</p> : null}
      <div className="grid-scroll">
        <table className="check-table price-grid">
          <thead>
            <tr>
              <th><input value={grid.rowLabel} maxLength={60} placeholder="Rækker" aria-label="Rækkernes navn" onChange={field("rowLabel")} /></th>
              {grid.columns.map((column, index) => (
                <th key={index} className="num">
                  <input value={column.label} maxLength={80} aria-label={`Kolonne ${index + 1}`} onChange={(event) => onChange((current) => ({ ...current, columns: current.columns.map((item, at) => at === index ? { ...item, label: event.target.value } : item) }))} />
                  <input className="detail" value={column.detail} maxLength={160} placeholder="Detalje" aria-label={`Kolonne ${index + 1}, detalje`} onChange={(event) => onChange((current) => ({ ...current, columns: current.columns.map((item, at) => at === index ? { ...item, detail: event.target.value } : item) }))} />
                </th>
              ))}
              <th aria-label="Fjern" />
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td><input value={row.label} maxLength={80} aria-label={`Række ${rowIndex + 1}`} onChange={(event) => onChange((current) => ({ ...current, rows: current.rows.map((line, at) => at === rowIndex ? { ...line, label: event.target.value } : line) }))} /></td>
                {row.cells.map((value, column) => (
                  <td key={column} {...flagged(`${rowIndex}:${column}`)}>
                    <input className={cellClass(value)} inputMode="decimal" value={value} aria-label={`${row.label}, ${grid.columns[column]?.label ?? column + 1}`} onChange={(event) => setCell(rowIndex, column, event.target.value)} />
                  </td>
                ))}
                <td><button type="button" className="icon-button" aria-label={`Fjern række ${rowIndex + 1}`} onClick={() => onChange((current) => ({ ...current, rows: current.rows.filter((_, at) => at !== rowIndex), unprinted: shiftRows(current.unprinted, rowIndex) }))}><Trash2 size={14} /></button></td>
              </tr>
            ))}
            {(["minimum", "maximum"] as const).map((which) => (
              <tr key={which} className="grid-limit">
                <td>{which === "minimum" ? "Minimum" : "Maksimum"}</td>
                {grid.columns.map((_, column) => {
                  const value = grid[which][column] ?? "";
                  const key = `${which === "minimum" ? "min" : "max"}:${column}`;
                  return (
                    <td key={column} {...flagged(key)}>
                      <input className={cellClass(value)} inputMode="decimal" value={value} aria-label={`${which === "minimum" ? "Minimum" : "Maksimum"}, ${grid.columns[column]?.label ?? column + 1}`} onChange={(event) => setLimit(which, column, event.target.value)} />
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-actions">
        <button type="button" className="text-button" onClick={() => onChange((current) => ({ ...current, rows: [...current.rows, { label: "", cells: current.columns.map(() => "") }] }))}><Plus size={14} /> Tilføj række</button>
        <button type="button" className="text-button muted" onClick={onRemove}>Fjern prisgitter</button>
      </div>
    </details>
  );
}
