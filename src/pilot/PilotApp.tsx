import { useState } from "react";
import {
  ArrowRight, ArrowUpRight, BarChart3, Check, ChevronRight, ClipboardCheck, Database, FileCheck2,
  FileText, History, LayoutGrid, LockKeyhole, Package, Plus,
} from "lucide-react";
import { AuditFlow } from "./audit.tsx";
import { importRows, parseCsv, suggestMapping } from "./csv.ts";
import { DEMO_INVOICE, DEMO_RATES } from "./demo.ts";
import {
  BENCHMARK_SERVICES, COVERAGE_TARGET, runAudit, VOLUME_BANDS, WEIGHT_BANDS,
  type AuditIndexEntry, type AuditInput, type AuditReport, type Contribution, type Coverage, type Volume,
} from "./freight.ts";
import { dateLabel, money, ReportView } from "./report.tsx";
import { coverageOf, loadAudits, recordAudit, saveAudits, type StoredAudit } from "./store.ts";

const NAV = [
  { id: "overview", label: "Overblik", icon: LayoutGrid },
  { id: "check", label: "Fakturakontrol", icon: ClipboardCheck },
  { id: "history", label: "Historik", icon: History },
  { id: "coverage", label: "Benchmark", icon: BarChart3 },
] as const;

type Tab = (typeof NAV)[number]["id"];
type View = Tab | "report";
type Result = {
  name: string;
  carrier: string;
  report: AuditReport;
  input: AuditInput | null;
  example: boolean;
  saved: AuditIndexEntry | null;
};

export function PilotApp() {
  const [view, setView] = useState<View>("overview");
  const [result, setResult] = useState<Result | null>(null);
  const [flowKey, setFlowKey] = useState(0);
  const [reportKey, setReportKey] = useState(0);
  const [history, setHistory] = useState<StoredAudit[]>(() => loadAudits());
  const activeTab = view === "report" ? "check" : view;
  const activeLabel = view === "report" ? "Rapport" : NAV.find((tab) => tab.id === activeTab)?.label;
  const coverage = coverageOf(history);

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0 });
  }

  function newAudit() {
    setResult(null);
    setFlowKey((value) => value + 1);
    navigate("check");
  }

  function receiveResult(next: Result) {
    setResult(next);
    setReportKey((value) => value + 1);
    navigate("report");
  }

  function demo() {
    const invoice = parseCsv(DEMO_INVOICE);
    const rates = parseCsv(DEMO_RATES);
    receiveResult({
      name: "Eksempel · Oktober 2026",
      carrier: "Demotransportør",
      example: true,
      saved: null,
      input: null,
      report: runAudit(
        importRows("invoice", invoice, suggestMapping("invoice", invoice.headers)),
        importRows("rates", rates, suggestMapping("rates", rates.headers)),
      ),
    });
  }

  function openReport(id: string) {
    const audit = history.find((item) => item.id === id);
    if (!audit) return;
    receiveResult({
      name: audit.name,
      carrier: audit.carrier,
      report: audit.report,
      input: null,
      example: false,
      saved: audit,
    });
  }

  function remember(next: StoredAudit[]) {
    const sorted = [...next].sort((first, second) => second.createdAt.localeCompare(first.createdAt)).slice(0, 100);
    setHistory(sorted);
    saveAudits(sorted);
  }

  async function saveReport(contribution: Contribution | null) {
    const input = result?.input;
    if (!input) return;
    const audit = recordAudit(input, result.report, contribution);
    remember([audit, ...history.filter((item) => item.id !== audit.id)]);
    setResult((current) => current?.input === input ? { ...current, saved: audit } : current);
  }

  async function removeReport() {
    const id = result?.saved?.id;
    if (!id) return;
    remember(history.filter((item) => item.id !== id));
    setResult(null);
    navigate("history");
  }

  async function revokeContribution() {
    const id = result?.saved?.id;
    if (!id) return;
    const next = history.map((item) => item.id === id ? { ...item, contributed: false, sampleCount: 0, samples: [] } : item);
    remember(next);
    const audit = next.find((item) => item.id === id) ?? null;
    setResult((current) => current?.saved?.id === id && audit ? { ...current, saved: audit } : current);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => navigate("overview")} aria-label="Fragtblik overblik">
          <BrandMark />
          <span>Fragtblik<span className="brand-sub">FRAGTØKONOMI</span></span>
        </button>
        <div className="workspace-label">ARBEJDSRUM</div>
        <nav aria-label="Hovedmenu">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={activeTab === id ? "nav-item active" : "nav-item"}
              aria-current={activeTab === id ? "page" : undefined}
              onClick={() => id === "check" && view !== "check" ? newAudit() : navigate(id)}
            >
              <Icon size={19} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="pilot-card">
            <div className="sidebar-icon"><Package size={17} /></div>
            <div><strong>Dansk pakkefragt</strong><span>Pilot · Version 1</span></div>
          </div>
          <div className="sidebar-private"><LockKeyhole size={13} /> Privat arbejdsrum</div>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb"><span>Arbejdsrum</span><ChevronRight size={14} /><strong>{activeLabel}</strong></div>
          <div className="topbar-right">
            <span className="pilot-tag"><i /> Pilot</span>
            <div className="avatar" title="Henrik Gandløse" aria-label="Henrik Gandløse">HG</div>
          </div>
        </header>

        <main className="main-content">
          {view === "overview" ? (
            <Overview
              history={history}
              coverage={coverage}
              onStart={newAudit}
              onExample={demo}
              onOpen={openReport}
              onHistory={() => navigate("history")}
              onCoverage={() => navigate("coverage")}
            />
          ) : null}
          {view === "check" || view === "report" ? (
            <div hidden={view !== "check"}>
              <AuditFlow
                key={flowKey}
                onExample={demo}
                onReport={(input, report) => receiveResult({
                  name: input.name, carrier: input.carrier, input, report, example: false, saved: null,
                })}
              />
            </div>
          ) : null}
          {view === "report" && result ? (
            <ReportView
              key={reportKey}
              {...result}
              onBack={() => navigate(result.saved ? "history" : result.example ? "overview" : "check")}
              onSave={saveReport}
              onRemove={removeReport}
              onRevoke={revokeContribution}
            />
          ) : null}
          {view === "history" ? (
            <div className="content-flow">
              <div className="page-intro split">
                <div>
                  <span className="eyebrow"><i /> GEMTE RAPPORTER</span>
                  <h1>Historik</h1>
                  <p>Åbn tidligere kontroller og administrér dine databidrag.</p>
                </div>
                <button className="button primary" type="button" onClick={newAudit}><Plus size={18} /> Nyt fakturatjek</button>
              </div>
              <section className="panel history-panel">
                <div className="section-heading"><h2>Seneste kontroller</h2><p>{history.length} gemte rapporter</p></div>
                <HistoryRows items={history} onOpen={openReport} onStart={newAudit} />
              </section>
            </div>
          ) : null}
          {view === "coverage" ? <BenchmarkView coverage={coverage} /> : null}
        </main>
        <footer className="main-footer"><span>Fragtblik</span><span>Privat pilot · Dansk indenrigs pakkefragt</span></footer>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" width="37" height="37">
      <rect width="40" height="40" rx="11" fill="#a9efd8" />
      <path d="M10 27h9l11-13h-8L11 26m19-12v8M10 27v-7" stroke="#173c35" strokeWidth="2.65" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HeroArt() {
  return (
    <svg viewBox="0 0 460 247" className="hero-art" aria-hidden="true">
      <defs>
        <linearGradient id="route-line" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#a8eed7" /><stop offset="1" stopColor="#55a9a2" stopOpacity=".35" /></linearGradient>
        <pattern id="route-grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0v22" fill="none" stroke="#a1d3ca" strokeOpacity=".17" /></pattern>
        <radialGradient id="route-light"><stop stopColor="#9ee5c8" stopOpacity=".18" /><stop offset="1" stopColor="#9ee5c8" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="272" cy="115" rx="193" ry="150" fill="url(#route-light)" />
      <path d="M104 20h356v227H104z" fill="url(#route-grid)" opacity=".8" />
      <path d="M37 201h93c27 0 50-16 66-42l31-52c14-22 37-35 64-35h111" fill="none" stroke="url(#route-line)" strokeWidth="2" strokeDasharray="5 7" strokeLinecap="round" />
      <circle cx="120" cy="201" r="7" fill="#255958" stroke="#83d2b8" strokeWidth="2" />
      <circle cx="402" cy="72" r="8" fill="#a8eed7" />
      <circle cx="402" cy="72" r="15" stroke="#9edccc" fill="none" opacity=".34" />
      <g transform="translate(161 38) rotate(-6 75 85)">
        <rect x="0" y="0" width="139" height="168" rx="16" fill="#203e44" stroke="#91c9be" strokeOpacity=".37" />
        <path d="M26 33h52M26 46h85M26 70h81M26 82h66M26 94h82" stroke="#91c9be" strokeOpacity=".5" strokeWidth="4" strokeLinecap="round" />
        <path d="M26 123h82" stroke="#91c9be" strokeOpacity=".25" />
        <path d="M26 141h33m27 0h22" stroke="#a8eed7" strokeOpacity=".7" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g transform="translate(251 108) rotate(6 75 39)">
        <rect width="153" height="78" rx="13" fill="#e3f7ee" />
        <rect x="12" y="14" width="39" height="39" rx="11" fill="#bdebd8" />
        <path d="m23 34 6 6 12-14" stroke="#1c684d" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M62 26h65m-65 13h48" stroke="#508478" strokeWidth="4" strokeLinecap="round" opacity=".65" />
        <path d="M12 64h128" stroke="#b8dacf" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function Overview({
  history, coverage, onStart, onExample, onOpen, onHistory, onCoverage,
}: {
  history: StoredAudit[];
  coverage: Coverage;
  onStart: () => void;
  onExample: () => void;
  onOpen: (id: string) => void;
  onHistory: () => void;
  onCoverage: () => void;
}) {
  const over = history.reduce((total, audit) => total + audit.summary.overOre, 0);
  const contributed = history.filter((audit) => audit.contributed).length;
  const ready = Object.values(coverage.groups).filter((count) => count >= COVERAGE_TARGET).length;

  return (
    <div className="content-flow overview">
      <div className="page-intro">
        <span className="eyebrow"><i /> FRAGTBLIK ARBEJDSRUM</span>
        <h1>Overblik</h1>
        <p>Kontrollér jeres fragtregninger og følg de afvigelser, I finder.</p>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-label"><span /> GRATIS FAKTURAKONTROL</span>
          <h2>Betaler I den aftalte<br className="desktop-only" /> fragtpris?</h2>
          <p>Indlæs en faktura og jeres prisaftale. Fragtblik sammenholder beløbene og viser, hvad I kan tage op med transportøren.</p>
          <div className="actions">
            <button type="button" className="button hero-primary" onClick={onStart}>Start fakturatjek <ArrowRight size={18} /></button>
            <button type="button" className="button hero-secondary" onClick={onExample}>Se eksempel <ArrowUpRight size={16} /></button>
          </div>
        </div>
        <HeroArt />
      </section>
      <div className="stat-grid">
        <div className="panel stat">
          <div className="stat-label"><span>Gemte fakturatjek</span><div className="icon-box"><FileCheck2 size={18} /></div></div>
          <strong>{history.length}</strong><small>I dit arbejdsrum</small>
        </div>
        <div className="panel stat">
          <div className="stat-label"><span>Mulig overfakturering</span><div className="icon-box"><BarChart3 size={18} /></div></div>
          <strong>{money(over)}</strong><small>Fundet i gemte kontroller</small>
        </div>
        <div className="panel stat">
          <div className="stat-label"><span>Rapporter med databidrag</span><div className="icon-box"><Database size={18} /></div></div>
          <strong>{contributed}</strong><small>Rapporter valgt til benchmark</small>
        </div>
      </div>
      <div className="overview-bottom">
        <section className="panel history-panel">
          <div className="section-heading split">
            <div><h2>Seneste kontroller</h2><p>Se og genåbn tidligere rapporter.</p></div>
            <button className="text-button muted" type="button" onClick={onHistory}>Historik <ChevronRight size={16} /></button>
          </div>
          <HistoryRows items={history.slice(0, 4)} onOpen={onOpen} onStart={onStart} />
        </section>
        <section className="panel coverage-summary">
          <div className="icon-box"><BarChart3 size={21} /></div>
          <span className="eyebrow">MARKEDSDATA</span>
          <h2>Benchmark for pakkefragt</h2>
          <p>Frivillige bidrag bruges til at opbygge datadækning for samme leveringsform, vægt og pakkevolumen.</p>
          <div className="coverage-mini"><strong>{ready} / 18</strong><span>grupper ved datamålet</span></div>
          <div className="progress" aria-hidden="true"><div style={{ width: `${ready / 18 * 100}%` }} /></div>
          <button className="text-button" type="button" onClick={onCoverage}>Se datadækning <ArrowRight size={16} /></button>
        </section>
      </div>
    </div>
  );
}

function HistoryRows({ items, onOpen, onStart }: {
  items: StoredAudit[];
  onOpen: (id: string) => void;
  onStart: () => void;
}) {
  if (!items.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><History size={24} /></div>
        <strong>Ingen gemte kontroller endnu</strong>
        <p>Dit første gemte fakturatjek vises her.</p>
        <button type="button" className="text-button" onClick={onStart}><Plus size={16} /> Start et tjek</button>
      </div>
    );
  }
  return (
    <ul className="history-list">
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" onClick={() => onOpen(item.id)}>
            <div className="icon-box"><FileText size={18} /></div>
            <div className="history-name"><strong>{item.name}</strong><small>{dateLabel(item.createdAt)}{item.carrier ? ` · ${item.carrier}` : ""}</small></div>
            <span className="history-amount">{money(item.summary.overOre)}<small>mulig overfakturering</small></span>
            <ChevronRight size={16} className="history-chevron" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function BenchmarkView({ coverage }: { coverage: Coverage }) {
  const [volume, setVolume] = useState<Volume>("small");
  const groups = BENCHMARK_SERVICES.flatMap((service) => WEIGHT_BANDS.map((band) => {
    const key = ["DK", service.key, band.key, volume].join("|");
    return { key, label: service.label, weight: band.label, count: coverage.groups[key] ?? 0 };
  }));
  const ready = groups.filter((group) => group.count >= COVERAGE_TARGET).length;
  return (
    <div className="content-flow">
      <div className="page-intro">
        <span className="eyebrow"><i /> DANSK INDENRIGS PAKKEFRAGT</span>
        <h1>Datadækning for benchmark</h1>
        <p>Følg antallet af fragtkøbere med kontrollerede prisdata i hver sammenligningsgruppe.</p>
      </div>
      <div className="message info"><Database size={19} /><div><strong>Markedsdata under opbygning</strong><p>Datamålet er 25 forskellige CVR-numre pr. gruppe. Denne fane viser dækningen for de seneste seks kalendermåneder inklusive den aktuelle måned.</p></div></div>
      <div className="stat-grid two">
        <div className="panel stat"><span>Virksomheder med databidrag</span><strong>{coverage.companies}</strong><small>Unikke CVR-numre på tværs af grupper</small></div>
        <div className="panel stat"><span>Grupper ved datamålet</span><strong>{ready} af 6</strong><small>I det valgte volumeninterval</small></div>
      </div>
      <section className="panel table-panel">
        <div className="section-heading split">
          <div><h2>Sammenligningsgrupper</h2><p>Danmark til Danmark · DKK</p></div>
          <label className="select-label">Årligt pakkevolumen
            <select value={volume} onChange={(event) => setVolume(event.target.value as Volume)}>
              {VOLUME_BANDS.map((band) => <option key={band.id} value={band.id}>{band.label}</option>)}
            </select>
          </label>
        </div>
        <div className="cohorts">
          {groups.map((group) => (
            <div className="cohort" key={group.key}>
              <div className="icon-box"><Package size={18} /></div>
              <div><strong>{group.label}</strong><small>{group.weight}</small></div>
              <div className="cohort-count">
                <span>{group.count} / {COVERAGE_TARGET}</span>
                <div className="progress" aria-hidden="true"><div style={{ width: `${Math.min(100, group.count / COVERAGE_TARGET * 100)}%` }} /></div>
              </div>
              <span className={`status ${group.count >= COVERAGE_TARGET ? "match" : "review"}`}>
                {group.count >= COVERAGE_TARGET ? <><Check size={12} /> Ved datamål</> : "Indsamler data"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
