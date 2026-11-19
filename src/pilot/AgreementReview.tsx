import { useMemo, useState } from "react";
import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { agreementFromRows, type Agreement } from "./agreements.ts";
import {
  decimalText, parseDecimal, SURCHARGE_KINDS, UNIT_SUGGESTIONS,
  type AgreementTerms, type PriceGrid, type SurchargeKind,
} from "./agreementFormat.ts";
import { agreementRatesToRows, type AgreementExtract, type AgreementRate, type ExtractGrid } from "./agreementExtract.ts";
import { kronerText, parseKroner, parseWeight } from "./invoiceCheck.ts";
import { CONFIDENCE_LABELS } from "./invoiceExtract.ts";

type RateDraft = { service: string; zone: string; weight: string; base: string; fuel: string; fixed: string; issues: string[] };
type ItemDraft = { category: string; description: string; unit: string; price: string; currency: string; note: string; issues: string[] };
type GridDraft = {
  name: string; category: string; unit: string; currency: string; rowLabel: string; note: string;
  columns: { label: string; detail: string }[];
  rows: { label: string; cells: string[] }[];
  minimum: string[];
  maximum: string[];
  unprinted: string[];
  issues: string[];
};
type SurchargeDraft = { label: string; kind: SurchargeKind; value: string; unit: string; scope: string; note: string; issues: string[] };
type ConditionDraft = { text: string; printed: boolean };

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
  rows: grid.rows.map((row) => ({ label: row.label, cells: row.cells.map(decimalText) })),
  minimum: grid.minimum.map(decimalText),
  maximum: grid.maximum.map(decimalText),
});

function parsePct(value: string): number | null {
  const clean = value.trim().replace(/\s|%$/g, "").replace(",", ".");
  if (!clean) return 0;
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const pct = Number(clean);
  return pct <= 300 ? pct : null;
}

function fromRate(draft: RateDraft): Omit<AgreementRate, "issues"> | null {
  const maxWeight = parseWeight(draft.weight);
  const baseOre = parseKroner(draft.base);
  const fuelPct = parsePct(draft.fuel);
  const fixedOre = draft.fixed.trim() ? parseKroner(draft.fixed) : 0;
  if (!draft.service.trim() || !maxWeight || baseOre === null || baseOre < 0 || fuelPct === null || fixedOre === null || fixedOre < 0) return null;
  return { service: draft.service, zone: draft.zone, maxWeight, baseOre, fuelPct, fixedOre };
}

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

export function AgreementReview({ extract, orgId, carriers, onBack, onSave }: {
  extract: AgreementExtract;
  orgId: string;
  carriers: string[];
  onBack: () => void;
  onSave: (agreement: Agreement) => void;
}) {
  const [rates, setRates] = useState<RateDraft[]>(() => extract.rates.map(toRate));
  const [items, setItems] = useState<ItemDraft[]>(() => extract.items.map((item) => ({ ...item, price: decimalText(item.price) })));
  const [grids, setGrids] = useState<GridDraft[]>(() => extract.grids.map(toGrid));
  const [surcharges, setSurcharges] = useState<SurchargeDraft[]>(() => extract.surcharges.map((item) => ({ ...item, value: decimalText(item.value) })));
  const [conditions, setConditions] = useState<ConditionDraft[]>(() => extract.conditions.map((item) => ({ ...item })));
  const [name, setName] = useState(() => (extract.title || extract.filename.replace(/\.[^.]+$/, "")).slice(0, 100));
  const [carrier, setCarrier] = useState(extract.carrier);
  const [from, setFrom] = useState(extract.validFrom);
  const [to, setTo] = useState(extract.validTo);
  const [problem, setProblem] = useState("");

  const parsedRates = useMemo(() => rates.map(fromRate), [rates]);
  const flagged = rates.filter((draft) => draft.issues.length).length + items.filter((item) => item.issues.length).length
    + grids.reduce((sum, grid) => sum + grid.unprinted.length, 0) + surcharges.filter((item) => item.issues.length).length
    + conditions.filter((item) => !item.printed).length;
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

  function save() {
    setProblem("");
    const badRate = parsedRates.findIndex((rate) => rate === null);
    if (badRate >= 0) {
      setProblem(`Pakkepris ${badRate + 1}. Udfyld leveringsform, vægttrin og grundpris med gyldige tal.`);
      return;
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
    try {
      const rows = agreementRatesToRows(parsedRates as Omit<AgreementRate, "issues">[], from, to);
      onSave(agreementFromRows(rows, { orgId, name, carrier, from, to }, new Date(), terms));
    } catch (error) {
      setProblem((error as Error).message);
    }
  }

  const coverage = extract.coverage.printed ? Math.round((extract.coverage.captured / extract.coverage.printed) * 100) : null;

  return (
    <div className="check-editor agreement-review">
      <div className="check-meta">
        <p>{[extract.carrier, extract.filename, counts.join(", ") || "ingen priser læst"].filter(Boolean).join(" · ")}</p>
        <div className="check-chips">
          <span className={`confidence ${extract.confidence}`}>{CONFIDENCE_LABELS[extract.confidence]}</span>
          {coverage !== null ? <span className="check-chip" title="Priser med decimaler i PDF'ens tekst, som udtrækket indeholder">{extract.coverage.captured} af {extract.coverage.printed} priser fundet ({coverage} %)</span> : null}
          {flagged ? <span className="check-chip warn"><CircleAlert size={13} /> {flagged} skal tjekkes</span> : null}
        </div>
      </div>
      <div className="review-fields">
        <label>Navn<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="F.eks. GLS 2027" /></label>
        <label>Transportør<input value={carrier} onChange={(event) => setCarrier(event.target.value)} maxLength={70} list="review-carriers" placeholder="Transportørens navn" /></label>
        <datalist id="review-carriers">{carriers.map((item) => <option key={item} value={item} />)}</datalist>
        <label>Gyldig fra<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Gyldig til<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <datalist id="review-units">{UNIT_SUGGESTIONS.map((unit) => <option key={unit} value={unit} />)}</datalist>
      {extract.issues.length ? <p className="check-problem" role="status"><CircleAlert size={14} /> {extract.issues.join(" ")}</p> : null}
      <p className="review-note">Felter markeret med gult står ikke ordret i PDF'ens tekst. Ret dem, eller slet dem, før aftalen gemmes.</p>

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
                  const flag = draft.issues.length ? { className: "edited", title: draft.issues.join(" ") } : {};
                  return (
                    <tr key={index}>
                      <td className="check-index" title={draft.issues.join(" ") || undefined}>{draft.issues.length ? <CircleAlert size={13} className="review-flag" /> : index + 1}</td>
                      <td {...flag}><input className={draft.service.trim() ? undefined : "invalid"} value={draft.service} maxLength={64} aria-label={`Leveringsform, række ${index + 1}`} onChange={(event) => editRate(index, "service", event.target.value)} /></td>
                      <td {...flag}><input value={draft.zone} maxLength={40} aria-label={`Zone, række ${index + 1}`} onChange={(event) => editRate(index, "zone", event.target.value)} /></td>
                      <td {...flag}><input className={parseWeight(draft.weight) ? "num" : "num invalid"} inputMode="decimal" value={draft.weight} aria-label={`Maks. kg, række ${index + 1}`} onChange={(event) => editRate(index, "weight", event.target.value)} /></td>
                      <td {...flag}><input className={parseKroner(draft.base) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.base} aria-label={`Grundpris, række ${index + 1}`} onChange={(event) => editRate(index, "base", event.target.value)} /></td>
                      <td {...flag}><input className={parsePct(draft.fuel) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.fuel} aria-label={`Brændstof, række ${index + 1}`} onChange={(event) => editRate(index, "fuel", event.target.value)} /></td>
                      <td {...flag}><input className={draft.fixed.trim() && parseKroner(draft.fixed) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.fixed} aria-label={`Fast tillæg, række ${index + 1}`} onChange={(event) => editRate(index, "fixed", event.target.value)} /></td>
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
                  <tr key={index}>
                    <td className="check-index" title={item.issues.join(" ") || undefined}>{item.issues.length ? <CircleAlert size={13} className="review-flag" /> : index + 1}</td>
                    <td><input value={item.category} maxLength={80} aria-label={`Kategori, pris ${index + 1}`} onChange={(event) => editItem(index, "category", event.target.value)} /></td>
                    <td><input className={item.description.trim() ? undefined : "invalid"} value={item.description} maxLength={200} aria-label={`Beskrivelse, pris ${index + 1}`} onChange={(event) => editItem(index, "description", event.target.value)} /></td>
                    <td><input value={item.unit} maxLength={60} list="review-units" aria-label={`Enhed, pris ${index + 1}`} onChange={(event) => editItem(index, "unit", event.target.value)} /></td>
                    <td className={item.issues.length ? "edited" : undefined} title={item.issues.join(" ") || undefined}><input className={bad(item.price) ? "num invalid" : "num"} inputMode="decimal" value={item.price} aria-label={`Pris ${index + 1}`} onChange={(event) => editItem(index, "price", event.target.value)} /></td>
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
                  <tr key={index}>
                    <td className="check-index" title={item.issues.join(" ") || undefined}>{item.issues.length ? <CircleAlert size={13} className="review-flag" /> : index + 1}</td>
                    <td><input className={item.label.trim() ? undefined : "invalid"} value={item.label} maxLength={120} aria-label={`Tillæg ${index + 1}`} onChange={(event) => editSurcharge(index, { label: event.target.value })} /></td>
                    <td>
                      <select value={item.kind} aria-label={`Type, tillæg ${index + 1}`} onChange={(event) => editSurcharge(index, { kind: event.target.value as SurchargeKind, ...(event.target.value === "agreed" ? { value: "" } : {}) })}>
                        {SURCHARGE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                      </select>
                    </td>
                    <td className={item.issues.length ? "edited" : undefined} title={item.issues.join(" ") || undefined}>
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
              <li key={index} className={item.printed ? undefined : "edited"} title={item.printed ? undefined : "Teksten står ikke ordret i PDF'en."}>
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
          <button type="button" className="button secondary" onClick={onBack}>Tilbage</button>
          <button type="button" className="button primary" onClick={save} disabled={empty}>Gem prisaftale</button>
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

function GridEditor({ grid, onChange, onRemove }: { grid: GridDraft; onChange: (change: (grid: GridDraft) => GridDraft) => void; onRemove: () => void }) {
  const unprinted = new Set(grid.unprinted);
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
  const flagged = (key: string) => unprinted.has(key) ? { className: "edited", title: "Tallet står ikke ordret i PDF'en." } : {};
  const field = (key: "name" | "category" | "unit" | "currency" | "rowLabel" | "note") =>
    (event: { target: { value: string } }) => onChange((current) => ({ ...current, [key]: event.target.value }));

  return (
    <details className="review-grid" open={grid.unprinted.length > 0 || grid.issues.length > 0}>
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
