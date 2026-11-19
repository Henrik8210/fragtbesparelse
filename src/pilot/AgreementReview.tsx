import { useMemo, useState } from "react";
import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { agreementFromRows, type Agreement } from "./agreements.ts";
import { agreementRatesToRows, type AgreementExtract, type AgreementRate } from "./agreementExtract.ts";
import { kronerText, parseKroner, parseWeight } from "./invoiceCheck.ts";
import { CONFIDENCE_LABELS } from "./invoiceExtract.ts";

type Draft = { service: string; zone: string; weight: string; base: string; fuel: string; fixed: string; issues: string[] };

const toDraft = (rate: AgreementRate): Draft => ({
  service: rate.service,
  zone: rate.zone,
  weight: rate.maxWeight ? String(rate.maxWeight).replace(".", ",") : "",
  base: rate.baseOre ? kronerText(rate.baseOre) : "",
  fuel: rate.fuelPct ? String(rate.fuelPct).replace(".", ",") : "",
  fixed: rate.fixedOre ? kronerText(rate.fixedOre) : "",
  issues: rate.issues,
});

function parsePct(value: string): number | null {
  const clean = value.trim().replace(/\s|%$/g, "").replace(",", ".");
  if (!clean) return 0;
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const pct = Number(clean);
  return pct <= 300 ? pct : null;
}

function fromDraft(draft: Draft): Omit<AgreementRate, "issues"> | null {
  const maxWeight = parseWeight(draft.weight);
  const baseOre = parseKroner(draft.base);
  const fuelPct = parsePct(draft.fuel);
  const fixedOre = draft.fixed.trim() ? parseKroner(draft.fixed) : 0;
  if (!draft.service.trim() || !maxWeight || baseOre === null || baseOre < 0 || fuelPct === null || fixedOre === null || fixedOre < 0) return null;
  return { service: draft.service, zone: draft.zone, maxWeight, baseOre, fuelPct, fixedOre };
}

const BLANK: Draft = { service: "", zone: "", weight: "", base: "", fuel: "", fixed: "", issues: [] };

export function AgreementReview({ extract, orgId, carriers, onBack, onSave }: {
  extract: AgreementExtract;
  orgId: string;
  carriers: string[];
  onBack: () => void;
  onSave: (agreement: Agreement) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => extract.rates.map(toDraft));
  const [name, setName] = useState(() => (extract.title || extract.filename.replace(/\.[^.]+$/, "")).slice(0, 100));
  const [carrier, setCarrier] = useState(extract.carrier);
  const [from, setFrom] = useState(extract.validFrom);
  const [to, setTo] = useState(extract.validTo);
  const [problem, setProblem] = useState("");

  const parsed = useMemo(() => drafts.map(fromDraft), [drafts]);
  const badRow = parsed.findIndex((rate) => rate === null);
  const flagged = drafts.filter((draft) => draft.issues.length > 0).length;

  function edit(index: number, field: keyof Omit<Draft, "issues">, value: string) {
    setDrafts((current) => current.map((draft, at) => at === index ? { ...draft, [field]: value, issues: [] } : draft));
  }

  function save() {
    setProblem("");
    if (badRow >= 0) {
      setProblem(`Række ${badRow + 1}. Udfyld leveringsform, vægttrin og grundpris med gyldige tal.`);
      return;
    }
    if (from && to && to < from) {
      setProblem("Slutdatoen skal ligge på eller efter startdatoen.");
      return;
    }
    try {
      const rows = agreementRatesToRows(parsed as Omit<AgreementRate, "issues">[], from, to);
      onSave(agreementFromRows(rows, { orgId, name, carrier, from, to }));
    } catch (error) {
      setProblem((error as Error).message);
    }
  }

  const surcharges = extract.surcharges.map((item) => `${item.label} ${item.pct ? `${String(item.pct).replace(".", ",")} %` : `${kronerText(item.amountOre)} kr.`}`);

  return (
    <div className="check-editor agreement-review">
      <div className="check-meta">
        <p>{[extract.carrier, extract.filename, `${drafts.length} ${drafts.length === 1 ? "pris" : "priser"} læst`].filter(Boolean).join(" · ")}</p>
        <div className="check-chips">
          <span className={`confidence ${extract.confidence}`}>{CONFIDENCE_LABELS[extract.confidence]}</span>
          {flagged ? <span className="check-chip warn"><CircleAlert size={13} /> {flagged} {flagged === 1 ? "række" : "rækker"} skal tjekkes</span> : null}
        </div>
      </div>
      <div className="review-fields">
        <label>Navn<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="F.eks. GLS 2027" /></label>
        <label>Transportør<input value={carrier} onChange={(event) => setCarrier(event.target.value)} maxLength={70} list="review-carriers" placeholder="Transportørens navn" /></label>
        <datalist id="review-carriers">{carriers.map((item) => <option key={item} value={item} />)}</datalist>
        <label>Gyldig fra<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Gyldig til<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      {surcharges.length ? <p className="review-note">Tillæg i PDF'en, lagt på alle rækker uden eget tillæg: {surcharges.join(" · ")}</p> : null}
      {extract.issues.length ? <p className="check-problem" role="status"><CircleAlert size={14} /> {extract.issues.join(" ")}</p> : null}
      <div className="check-scroll">
        <table className="check-table">
          <thead>
            <tr>
              <th>#</th><th>Leveringsform</th><th>Zone</th><th className="num">Maks. kg</th><th className="num">Grundpris kr.</th><th className="num">Brændstof %</th><th className="num">Fast tillæg kr.</th><th aria-label="Fjern" />
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft, index) => {
              const flag = draft.issues.length ? { className: "edited", title: draft.issues.join(" ") } : {};
              return (
                <tr key={index}>
                  <td className="check-index" title={draft.issues.join(" ") || undefined}>{draft.issues.length ? <CircleAlert size={13} className="review-flag" /> : index + 1}</td>
                  <td {...flag}><input className={draft.service.trim() ? undefined : "invalid"} value={draft.service} maxLength={64} aria-label={`Leveringsform, række ${index + 1}`} onChange={(event) => edit(index, "service", event.target.value)} /></td>
                  <td {...flag}><input value={draft.zone} maxLength={40} aria-label={`Zone, række ${index + 1}`} onChange={(event) => edit(index, "zone", event.target.value)} /></td>
                  <td {...flag}><input className={parseWeight(draft.weight) ? "num" : "num invalid"} inputMode="decimal" value={draft.weight} aria-label={`Maks. kg, række ${index + 1}`} onChange={(event) => edit(index, "weight", event.target.value)} /></td>
                  <td {...flag}><input className={parseKroner(draft.base) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.base} aria-label={`Grundpris, række ${index + 1}`} onChange={(event) => edit(index, "base", event.target.value)} /></td>
                  <td {...flag}><input className={parsePct(draft.fuel) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.fuel} aria-label={`Brændstof, række ${index + 1}`} onChange={(event) => edit(index, "fuel", event.target.value)} /></td>
                  <td {...flag}><input className={draft.fixed.trim() && parseKroner(draft.fixed) === null ? "num invalid" : "num"} inputMode="decimal" value={draft.fixed} aria-label={`Fast tillæg, række ${index + 1}`} onChange={(event) => edit(index, "fixed", event.target.value)} /></td>
                  <td><button type="button" className="icon-button" aria-label={`Fjern række ${index + 1}`} onClick={() => setDrafts((current) => current.filter((_, at) => at !== index))}><Trash2 size={14} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="check-foot">
        <div className="check-sums">
          <button type="button" className="text-button" onClick={() => setDrafts((current) => [...current, { ...BLANK }])}><Plus size={14} /> Tilføj række</button>
          <span>En zone lægges sammen med leveringsformen, fx «Pakkeshop Zone 2».</span>
        </div>
        {flagged ? (
          <p className="check-problem" role="status">
            <CircleAlert size={14} /> {drafts.flatMap((draft, index) => draft.issues.length ? [`Række ${index + 1}: ${draft.issues.join(" ")}`] : []).slice(0, 3).join(" · ")}
          </p>
        ) : null}
        {problem ? <p className="check-problem" role="alert"><CircleAlert size={14} /> {problem}</p> : null}
        <div className="check-actions">
          <button type="button" className="button secondary" onClick={onBack}>Tilbage</button>
          <button type="button" className="button primary" onClick={save} disabled={drafts.length === 0}>Gem prisaftale</button>
        </div>
      </div>
    </div>
  );
}
