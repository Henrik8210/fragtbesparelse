import { Fragment, useMemo, useState } from "react";
import {
  ArrowDownToLine, ArrowLeft, Check, ChevronDown, CircleAlert, Database,
  FileCheck2, Save, Search, ShieldCheck, Trash2,
} from "lucide-react";
import { reportCsv } from "./csv.ts";
import {
  benchmarkSamples, CONSENT_TEXT, CONSENT_VERSION, STATUS_LABELS, VOLUME_BANDS, serviceLabel,
  type AuditIndexEntry, type AuditReport, type Contribution, type LineStatus, type Volume,
} from "./freight.ts";
import { downloadCsv } from "./audit.tsx";

const dkk = new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" });
export function money(ore: number) { return dkk.format(ore / 100); }
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Copenhagen" })
    .format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}

type Filter = "all" | LineStatus;

export function ReportView({
  report, name, carrier, example, saved, onBack, onSave, onRemove, onRevoke,
}: {
  report: AuditReport;
  name: string;
  carrier: string;
  example: boolean;
  saved: AuditIndexEntry | null;
  onBack: () => void;
  onSave: (contribution: Contribution | null) => Promise<void>;
  onRemove: () => Promise<void>;
  onRevoke: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [share, setShare] = useState(false);
  const [volume, setVolume] = useState<Volume | "">("");
  const [cvr, setCvr] = useState("");
  const [confirm, setConfirm] = useState<"delete" | "revoke" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(50);
  const summary = report.summary;
  const eligible = useMemo(() => benchmarkSamples(report, "small").length, [report]);
  const lines = useMemo(() => report.lines.filter((line) =>
    (filter === "all" || line.status === filter) &&
    (!query.trim() || line.shipment.toLowerCase().includes(query.trim().toLowerCase()) ||
      line.service.toLowerCase().includes(query.trim().toLowerCase()))
  ), [report, filter, query]);

  const statuses: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "Alle", count: report.lines.length },
    { key: "over", label: "Over aftalen", count: summary.over },
    { key: "under", label: "Under aftalen", count: summary.under },
    { key: "review", label: "Til gennemgang", count: summary.review },
    { key: "match", label: "Stemmer", count: summary.match },
  ];

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (share && (!/^\d{8}$/.test(cvr.trim()) || !volume)) {
      setError("Angiv et CVR-nummer på otte cifre og et årligt pakkevolumen.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await onSave(share && volume ? { cvr: cvr.trim(), volume, consentVersion: CONSENT_VERSION } : null);
      setShowSave(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function handleChange() {
    setPending(true);
    setError("");
    try {
      if (confirm === "delete") await onRemove();
      if (confirm === "revoke") await onRevoke();
      setConfirm(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="content-flow">
      <button className="text-button muted back-button" type="button" onClick={onBack}><ArrowLeft size={16} /> Tilbage</button>
      <div className="page-intro split">
        <div>
          <span className="eyebrow"><i /> FAKTURARAPPORT</span>
          <h1>{name}</h1>
          <p>{carrier ? `${carrier} · ` : ""}{report.lines.length.toLocaleString("da-DK")} forsendelser · DKK ekskl. moms</p>
        </div>
        <div className="actions">
          <button type="button" className="button secondary" onClick={() => downloadCsv("freightlytics-fakturarapport.csv", reportCsv(report))}><ArrowDownToLine size={17} /> Eksportér CSV</button>
          {!example && !saved ? (
            <button type="button" className="button primary" aria-expanded={showSave} onClick={() => { setShowSave(!showSave); setError(""); }}><Save size={17} /> Gem rapport</button>
          ) : null}
        </div>
      </div>

      {example ? <div className="message info"><FileCheck2 size={18} /><div><strong>Eksempel med fiktive data</strong><p>Prøv at åbne en linje for at se, hvordan aftaleprisen er beregnet.</p></div></div> : null}
      {saved ? <div className="message success"><Check size={18} /><div><strong>Gemt i dit arbejdsrum</strong><p>{saved.contributed ? `${saved.sampleCount} kontrollerede forsendelser er tilføjet som databidrag.` : "Rapporten er gemt til egen brug."}</p></div></div> : null}

      <div className="stat-grid report-stats">
        <div className="panel stat"><span>Faktureret i alt</span><strong>{money(summary.billedOre)}</strong><small>{money(summary.checkedOre)} er kontrolleret</small></div>
        <div className="panel stat emphasis"><span>Mulig overfakturering</span><strong>{money(summary.overOre)}</strong><small>{summary.over} linjer over aftalen</small></div>
        <div className="panel stat"><span>Beregnet aftalepris</span><strong>{money(summary.expectedOre)}</strong><small>For de kontrollerede linjer</small></div>
        <div className="panel stat"><span>Kræver gennemgang</span><strong>{summary.review}</strong><small>Linjer til manuel afstemning</small></div>
      </div>

      {showSave && !saved ? (
        <form className="panel save-panel" onSubmit={(event) => void handleSave(event)}>
          <div className="icon-box"><Database size={20} /></div>
          <div>
            <h2>Gem resultatet</h2>
            <p>Rapporten gemmes i din historik. Du kan vælge at bidrage med kontrollerede priser til den samlede markedsstatistik.</p>
            <label className="checkbox-line">
              <input type="checkbox" disabled={!eligible} checked={share} onChange={(event) => setShare(event.target.checked)} />
              <span>{CONSENT_TEXT}</span>
            </label>
            <p className="quiet">{eligible ? `${eligible} forsendelser passer til pilotens grupper. Du kan fjerne dit bidrag igen fra rapporten.` : "Rapporten har ingen kontrollerede forsendelser i pilotens benchmarkgrupper."}</p>
            {share ? (
              <div className="input-grid">
                <label>Virksomhedens CVR<input value={cvr} onChange={(event) => setCvr(event.target.value)} inputMode="numeric" maxLength={8} placeholder="Otte cifre" required /></label>
                <label>Årligt pakkevolumen
                  <select value={volume} onChange={(event) => setVolume(event.target.value as Volume | "")} required>
                    <option value="">Vælg volumen</option>
                    {VOLUME_BANDS.map((band) => <option key={band.id} value={band.id}>{band.label}</option>)}
                  </select>
                </label>
              </div>
            ) : null}
            {error ? <p className="inline-error" role="alert">{error}</p> : null}
            <div className="actions">
              <button className="button primary" type="submit" disabled={pending}>{pending ? "Gemmer…" : "Gem i historik"}</button>
              <button type="button" className="button secondary" onClick={() => { setShowSave(false); setError(""); }} disabled={pending}>Luk</button>
            </div>
          </div>
        </form>
      ) : null}

      <section className="panel table-panel">
        <div className="section-heading split">
          <div><h2>Forsendelser</h2><p>Åbn en linje for at se prisreglen og beregningen.</p></div>
          <label className="search"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setShown(50); }} placeholder="Søg efter forsendelse" aria-label="Søg efter forsendelse" /></label>
        </div>
        <div className="filter-row" aria-label="Filtrér forsendelser">
          {statuses.map((item) => (
            <button
              type="button"
              key={item.key}
              aria-pressed={item.key === filter}
              className={item.key === filter ? "selected" : ""}
              onClick={() => { setFilter(item.key); setShown(50); setExpanded(null); }}
            >
              {item.label} <span>{item.count}</span>
            </button>
          ))}
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Fakturalinjer">
          <table className="data-table">
            <thead><tr><th>Forsendelse</th><th>Leveringsform</th><th className="right">Faktureret</th><th className="right">Aftalt</th><th className="right">Forskel</th><th>Status</th></tr></thead>
            <tbody>
              {lines.slice(0, shown).map((line) => (
                <Fragment key={line.key}>
                  <tr>
                    <td>
                      <button type="button" className="row-link" aria-expanded={line.key === expanded} onClick={() => setExpanded(line.key === expanded ? null : line.key)}>
                        <ChevronDown size={15} className={line.key === expanded ? "rotate" : ""} />{line.shipment}
                      </button>
                      <small>{dateLabel(line.date)}</small>
                    </td>
                    <td>{serviceLabel(line.service)}<small>{line.weight.toLocaleString("da-DK")} kg</small></td>
                    <td className="right mono">{money(line.billedOre)}</td>
                    <td className="right mono">{line.expectedOre === null ? "—" : money(line.expectedOre)}</td>
                    <td className={`right mono ${line.status === "over" ? "text-alert" : ""}`}>{line.differenceOre === null ? "—" : `${line.differenceOre > 0 ? "+" : ""}${money(line.differenceOre)}`}</td>
                    <td><span className={`status ${line.status}`}>{STATUS_LABELS[line.status]}</span></td>
                  </tr>
                  {line.key === expanded ? (
                    <tr className="detail-row"><td colSpan={6}>
                      <p><strong>{line.reason}</strong></p>
                      {line.rate ? <p>Vægttrin op til {line.rate.maxWeight.toLocaleString("da-DK")} kg. Grundpris {money(line.rate.baseOre)} + brændstof ({line.rate.fuelPct.toLocaleString("da-DK")} %) {money(line.rate.fuelOre)} + fast tillæg {money(line.rate.fixedOre)} = <strong>{money(line.expectedOre ?? 0)}</strong>.</p> : null}
                      {line.rate && (line.rate.from || line.rate.to) ? <p className="quiet">Gyldighed {line.rate.from || "åben"} til {line.rate.to || "åben"}.</p> : null}
                    </td></tr>
                  ) : null}
                </Fragment>
              ))}
              {!lines.length ? <tr><td colSpan={6} className="empty-table">Ingen forsendelser matcher dit filter.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {lines.length > shown ? <div className="table-more"><button type="button" className="button secondary" onClick={() => setShown(shown + 50)}>Vis flere linjer ({shown} af {lines.length})</button></div> : null}
      </section>
      {saved ? (
        <section className="panel save-panel">
          <div className="icon-box"><ShieldCheck size={19} /></div>
          <div>
            <h2>Data og adgang</h2>
            <p>Administrér denne rapport og dens eventuelle bidrag til markedsdækningen.</p>
            <div className="actions">
              {saved.contributed ? <button type="button" className="button secondary" onClick={() => { setConfirm("revoke"); setError(""); }}>Fjern databidrag</button> : null}
              <button type="button" className="button secondary danger" onClick={() => { setConfirm("delete"); setError(""); }}><Trash2 size={15} /> Slet rapport</button>
            </div>
            {confirm ? (
              <div className="message info confirm" role="alert">
                <CircleAlert size={19} />
                <div>
                  <strong>{confirm === "delete" ? "Slet rapporten og et eventuelt databidrag?" : "Fjern rapportens bidrag fra benchmark?"}</strong>
                  {error ? <p className="inline-error">{error}</p> : null}
                  <div className="actions">
                    <button type="button" className="button primary" onClick={() => void handleChange()} disabled={pending}>{pending ? "Behandler…" : "Bekræft"}</button>
                    <button type="button" className="button secondary" onClick={() => setConfirm(null)} disabled={pending}>Annullér</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
