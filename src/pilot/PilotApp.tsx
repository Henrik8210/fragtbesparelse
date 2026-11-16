import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight, ArrowUpRight, BarChart3, ChevronDown, ChevronRight, ClipboardCheck, Database, FileCheck2,
  FileText, History, LayoutGrid, LockKeyhole, Package, Plus,
} from "lucide-react";
import { ApiError, api } from "../api.ts";
import { carrierProfiles } from "../data/carriers.ts";
import { AuditFlow } from "./audit.tsx";
import {
  BENCHMARK_SERVICES, WEIGHT_BANDS, serviceKey,
  type AuditIndexEntry, type AuditInput, type AuditReport, type Contribution,
} from "./freight.ts";
import { carrierPeers, loadOrgId, orgAudit, orgFromCompany, ORGS, peerCount, saveOrgId, type Org } from "./orgs.ts";
import { dateLabel, money, ReportView } from "./report.tsx";
import { loadAudits, recordAudit, saveAudits, type StoredAudit } from "./store.ts";

const NAV = [
  { id: "overview", label: "Overblik", icon: LayoutGrid },
  { id: "check", label: "Fakturakontrol", icon: ClipboardCheck },
  { id: "history", label: "Historik", icon: History },
  { id: "coverage", label: "Benchmark", icon: BarChart3 },
] as const;

type Company = { id: string; name: string; industry: string; place: string };
type Notice = { id: string; name: string; company: string; email: string; createdAt: string };
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
  const [orgId, setOrgId] = useState(loadOrgId);
  const [extraOrgs, setExtraOrgs] = useState<Company[]>([]);
  const [orgsReady, setOrgsReady] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [gate, setGate] = useState<"checking" | "closed" | "open">("checking");
  const orgs = useMemo(
    () => [...ORGS, ...extraOrgs.filter((item) => !ORGS.some((sample) => sample.id === item.id)).map(orgFromCompany)],
    [extraOrgs],
  );
  const org = orgs.find((item) => item.id === orgId) ?? ORGS[0];
  const sampleReport = useMemo(() => orgAudit(org), [org]);
  const checks = useMemo<StoredAudit[]>(() => [
    ...(sampleReport.lines.length === 0 ? [] : [{
      id: `sample:${org.id}`,
      name: "Oktober 2026",
      carrier: org.carrier,
      createdAt: "2026-10-31T11:00:00.000Z",
      summary: sampleReport.summary,
      contributed: false,
      sampleCount: 0,
      report: sampleReport,
      samples: [],
      orgId: org.id,
    }]),
    ...history.filter((item) => item.orgId === org.id),
  ], [history, org, sampleReport]);
  const activeTab = view === "report" ? "check" : view;
  const activeLabel = view === "report" ? "Rapport" : NAV.find((tab) => tab.id === activeTab)?.label;
  const peers = peerCount(org.id);

  useEffect(() => {
    let gone = false;
    api<{ user: { role: string } | null }>("/api/me")
      .then(async (me) => {
        if (gone) return;
        if (!me.user) {
          setAdmin(false);
          setGate("closed");
          setOrgsReady(true);
          return;
        }
        const isAdmin = me.user.role === "admin";
        setAdmin(isAdmin);
        if (isAdmin) {
          try {
            const body = await api<{ orgs: Company[] }>("/api/pilot-orgs");
            if (!gone) setExtraOrgs(body.orgs);
          } catch {
            // The sample companies still show when the saved list cannot be read.
          }
          const notes = await loadNotices();
          if (!gone) setNotices(notes);
        }
        setGate("open");
        setOrgsReady(true);
      })
      .catch(() => {
        if (!gone) {
          setGate("closed");
          setOrgsReady(true);
        }
      });
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    if (orgsReady && !orgs.some((item) => item.id === orgId)) setOrgId(ORGS[0].id);
  }, [orgsReady, orgs, orgId]);

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

  function chooseOrg(id: string) {
    setOrgId(id);
    saveOrgId(id);
    setResult(null);
    if (view === "report") navigate("overview");
  }

  function demo() {
    receiveResult({
      name: "Oktober 2026",
      carrier: org.carrier,
      example: true,
      saved: null,
      input: null,
      report: sampleReport,
    });
  }

  function openReport(id: string) {
    const audit = checks.find((item) => item.id === id);
    if (!audit) return;
    receiveResult({
      name: audit.name,
      carrier: audit.carrier,
      report: audit.report,
      input: null,
      example: id.startsWith("sample:"),
      saved: id.startsWith("sample:") ? null : audit,
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
    const audit = recordAudit(input, result.report, contribution, org.id);
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

  async function enter(username: string, password: string) {
    const signed = await api<{ user: { role: string } }>("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
    const isAdmin = signed.user.role === "admin";
    setAdmin(isAdmin);
    if (isAdmin) {
      try {
        const body = await api<{ orgs: Company[] }>("/api/pilot-orgs");
        setExtraOrgs(body.orgs);
      } catch {
        // The sample companies still show when the saved list cannot be read.
      }
      setNotices(await loadNotices());
    } else {
      setExtraOrgs([]);
      setNotices([]);
    }
    setGate("open");
  }

  async function dismissNotice(id: string) {
    setNotices((current) => current.filter((item) => item.id !== id));
    await api(`/api/notifications/${encodeURIComponent(id)}/seen`, { method: "POST" }).catch(() => undefined);
  }

  if (gate !== "open") {
    return <SignedOut ready={gate === "closed"} onEnter={enter} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => navigate("overview")} aria-label="Freightlytics overblik">
          <BrandMark />
          <span>Freightlytics<span className="brand-sub">FRAGTØKONOMI</span></span>
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
            <OrgSwitch
              admin={admin}
              org={org}
              orgs={orgs}
              created={extraOrgs}
              onChange={chooseOrg}
              onUpdated={(updated) => {
                setExtraOrgs((current) => current.map((item) => item.id === updated.id ? updated : item));
              }}
              onRemoved={(id) => {
                setExtraOrgs((current) => current.filter((item) => item.id !== id));
                if (orgId === id) chooseOrg(ORGS[0].id);
              }}
              onSignedOut={() => { setAdmin(false); setGate("closed"); }}
            />
            <AccountMenu
              admin={admin}
              onCreated={(created) => {
                setExtraOrgs((current) => [...current.filter((item) => item.id !== created.id), created]);
                chooseOrg(created.id);
              }}
              onSignedOut={() => { setAdmin(false); setGate("closed"); }}
            />
          </div>
        </header>

        {admin && notices.length ? (
          <div className="notice-list" aria-live="polite">
            {notices.map((item) => (
              <article className="notice" key={item.id}>
                <div>
                  <strong>Demoønske</strong>
                  <p>{item.name} · {item.company}</p>
                  <p>{item.email}</p>
                </div>
                <button type="button" onClick={() => void dismissNotice(item.id)}>Luk</button>
              </article>
            ))}
          </div>
        ) : null}
        <main className="main-content">
          {view === "overview" ? (
            <Overview
              history={checks}
              peers={peers}
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
                <div className="section-heading"><h2>Seneste kontroller</h2><p>{checks.length} kontroller</p></div>
                <HistoryRows items={checks} onOpen={openReport} onStart={newAudit} />
              </section>
            </div>
          ) : null}
          {view === "coverage" ? <BenchmarkView report={sampleReport} orgId={org.id} peers={peers} /> : null}
        </main>
        <footer className="main-footer"><span>Freightlytics</span><span>Privat pilot · Dansk indenrigs pakkefragt</span></footer>
      </div>
    </div>
  );
}

function AccountMenu({ admin, onCreated, onSignedOut }: {
  admin: boolean;
  onCreated: (org: Company) => void;
  onSignedOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [place, setPlace] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  async function submitOrg() {
    if (!name.trim()) {
      setProblem("Skriv et navn.");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      const createdOrg = await saveCompany("POST", "/api/pilot-orgs", { name, industry, place });
      setName("");
      setIndustry("");
      setPlace("");
      setCreating(false);
      setOpen(false);
      onCreated(createdOrg);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "error";
      if (code === "sign-in") {
        onSignedOut();
        return;
      }
      if (code === "taken") setProblem("Navnet er allerede brugt.");
      else if (code === "name") setProblem("Skriv et navn.");
      else if (code === "industry") setProblem("Skriv en branche.");
      else if (code === "place") setProblem("Skriv et sted.");
      else if (code === "limit") setProblem("Der kan ikke oprettes flere lige nu.");
      else setProblem("Organisationen blev ikke oprettet.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api("/api/logout", { method: "POST" }).catch(() => undefined);
    setOpen(false);
    onSignedOut();
  }

  return (
    <div className="account-menu" ref={root}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label="Konto" onClick={() => setOpen((value) => !value)}>HG</button>
      {open ? (
        <div className="account-pop" role="menu" aria-label="Konto">
          {admin ? (
            creating ? (
              <CompanyForm
                name={name}
                industry={industry}
                place={place}
                problem={problem}
                busy={busy}
                submitLabel="Opret"
                onName={setName}
                onIndustry={setIndustry}
                onPlace={setPlace}
                onSubmit={() => void submitOrg()}
              />
            ) : (
              <button type="button" role="menuitem" onClick={() => { setCreating(true); setName(""); setIndustry(""); setPlace(""); setProblem(""); }}>Opret organisation</button>
            )
          ) : null}
          <button type="button" role="menuitem" onClick={() => void logout()}>Log ud</button>
        </div>
      ) : null}
    </div>
  );
}

function OrgSwitch({ admin, org, orgs, created, onChange, onUpdated, onRemoved, onSignedOut }: {
  admin: boolean;
  org: Org;
  orgs: Org[];
  created: Company[];
  onChange: (id: string) => void;
  onUpdated: (org: Company) => void;
  onRemoved: (id: string) => void;
  onSignedOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [place, setPlace] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const saved = created.filter((item) => !ORGS.some((sample) => sample.id === item.id));
  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function orgProblem(error: unknown, fallback: string) {
    const code = error instanceof ApiError ? error.code : "error";
    if (code === "sign-in") {
      onSignedOut();
      return;
    }
    if (code === "taken") setProblem("Navnet er allerede brugt.");
    else if (code === "name") setProblem("Skriv et navn.");
    else if (code === "industry") setProblem("Skriv en branche.");
    else if (code === "place") setProblem("Skriv et sted.");
    else if (code === "limit") setProblem("Der kan ikke oprettes flere lige nu.");
    else if (code === "used") setProblem("Organisationen har stadig poster og kan ikke slettes.");
    else if (code === "forbidden") setProblem("De seks prøveorganisationer bliver.");
    else setProblem(fallback);
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setProblem("");
    try {
      const updated = await saveCompany("PATCH", `/api/pilot-orgs/${encodeURIComponent(id)}`, { name, industry, place });
      setEditing(null);
      onUpdated(updated);
    } catch (error) {
      orgProblem(error, "Organisationen blev ikke gemt.");
    } finally {
      setBusy(false);
    }
  }

  async function removeOrg(id: string) {
    setBusy(true);
    setProblem("");
    try {
      await api(`/api/pilot-orgs/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (editing === id) setEditing(null);
      onRemoved(id);
    } catch (error) {
      orgProblem(error, "Organisationen blev ikke slettet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="org-switch" ref={root}>
      <button
        type="button"
        className="org-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Organisation: ${org.name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{org.name}</span>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <ul className="org-menu" role="listbox" aria-label="Organisationer">
          {orgs.filter((item) => ORGS.some((sample) => sample.id === item.id)).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={item.id === org.id}
                onClick={() => { onChange(item.id); setOpen(false); }}
              >
                {item.name}
              </button>
            </li>
          ))}
          {saved.map((item) => (
            <li key={item.id}>
              {admin && editing === item.id ? (
                <CompanyForm
                  name={name}
                  industry={industry}
                  place={place}
                  problem={problem}
                  busy={busy}
                  submitLabel="Gem"
                  onName={setName}
                  onIndustry={setIndustry}
                  onPlace={setPlace}
                  onSubmit={() => void saveEdit(item.id)}
                />
              ) : (
                <div className="org-item">
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.id === org.id}
                    onClick={() => { onChange(item.id); setOpen(false); }}
                  >
                    {item.name}
                  </button>
                  {admin ? (
                    <span className="org-manage">
                      <button type="button" onClick={() => { setEditing(item.id); setName(item.name); setIndustry(item.industry); setPlace(item.place); setProblem(""); }}>Ret</button>
                      <button type="button" onClick={() => void removeOrg(item.id)} disabled={busy}>Slet</button>
                    </span>
                  ) : null}
                </div>
              )}
            </li>
          ))}
          {problem && editing === null ? <li><p className="org-note">{problem}</p></li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function CompanyForm({ name, industry, place, problem, busy, submitLabel, onName, onIndustry, onPlace, onSubmit }: {
  name: string;
  industry: string;
  place: string;
  problem: string;
  busy: boolean;
  submitLabel: string;
  onName: (value: string) => void;
  onIndustry: (value: string) => void;
  onPlace: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form className="org-create" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <input value={name} onChange={(event) => onName(event.target.value)} placeholder="Navn" aria-label="Navn" maxLength={80} required />
      <input value={industry} onChange={(event) => onIndustry(event.target.value)} placeholder="Branche" aria-label="Branche" maxLength={80} required />
      <input value={place} onChange={(event) => onPlace(event.target.value)} placeholder="Sted" aria-label="Sted" maxLength={80} required />
      {problem ? <p className="org-note">{problem}</p> : null}
      <button className="button primary" type="submit" disabled={busy}>{submitLabel}</button>
    </form>
  );
}

async function saveCompany(method: "POST" | "PATCH", path: string, fields: { name: string; industry: string; place: string }): Promise<Company> {
  const saved = await api<{ org: Company }>(path, { method, body: JSON.stringify(fields) });
  return saved.org;
}

async function loadNotices(): Promise<Notice[]> {
  try {
    const body = await api<{ notifications: Notice[] }>("/api/notifications");
    return body.notifications;
  } catch {
    return [];
  }
}

function SignedOut({ ready, onEnter }: { ready: boolean; onEnter: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoName, setDemoName] = useState("");
  const [demoCompany, setDemoCompany] = useState("");
  const [demoEmail, setDemoEmail] = useState("");
  const [demoProblem, setDemoProblem] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  useEffect(() => {
    document.title = "Freightlytics";
    if (window.location.hash === "#/login" || window.location.hash === "#login") {
      document.getElementById("login")?.scrollIntoView();
    }
  }, []);

  async function askDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? demoName).trim();
    const company = String(data.get("company") ?? demoCompany).trim();
    const email = String(data.get("email") ?? demoEmail).trim();
    setDemoName(name);
    setDemoCompany(company);
    setDemoEmail(email);
    setDemoBusy(true);
    setDemoProblem("");
    try {
      await api("/api/demo", { method: "POST", body: JSON.stringify({ name, company, email }) });
      setDemoDone(true);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "";
      setDemoProblem(code === "limit" ? "Prøv igen senere." : code === "email" ? "Skriv en e-mail." : "Vi kunne ikke gemme det. Prøv igen.");
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <div className="marketing">
      <header className="marketing-bar">
        <a href="#top"><BrandMark />Freightlytics</a>
        <nav>
          <a href="#demo">Prøv demo</a>
          <a className="button primary" href="#login">Log ind</a>
        </nav>
      </header>
      <main id="top">
        <section className="marketing-hero">
          <div>
            <h1>Betaler I den aftalte fragtpris?</h1>
            <p>Sammenhold fakturaen med prisaftalen. Se afvigelsen i kroner, og hvad I kan tage op med transportøren.</p>
            <div className="actions">
              <a className="button primary" href="#demo">Prøv vores demo</a>
              <a className="button secondary" href="#login">Log ind</a>
            </div>
          </div>
          <CoverMotion />
        </section>
        <section className="marketing-points" aria-label="Det Freightlytics svarer på">
          <article className="marketing-card">
            <span>Fakturakontrol</span>
            <h2>Betaler vi det, vi aftalte?</h2>
            <p>Linjerne, der afviger fra prisaftalen, og beløbet I kan tage op med transportøren.</p>
          </article>
          <article className="marketing-card">
            <span>Benchmark</span>
            <h2>Er aftalen konkurrencedygtig?</h2>
            <p>Lignende firmaer i prøven bag tallene. Ikke et live marked.</p>
          </article>
          <article className="marketing-card">
            <span>Transportør</span>
            <h2>Hvilke transportører passer?</h2>
            <p>Et eksempel på, hvor godt en transportør passer til forsendelserne.</p>
          </article>
        </section>
        <p className="marketing-note">Tallene i arbejdsrummet er prøvedata.</p>
        <section className="marketing-demo" id="demo">
          <h2>Prøv vores demo</h2>
          <p>Skriv navn, firma og e-mail. Admin ser ønsket efter login. Der sendes ingen e-mail.</p>
          {demoDone ? <p className="marketing-done">Tak. Vi har noteret det.</p> : (
            <form onSubmit={(event) => void askDemo(event)}>
              <label>
                Navn
                <input name="name" value={demoName} onChange={(event) => setDemoName(event.target.value)} maxLength={80} required />
              </label>
              <label>
                Firma
                <input name="company" value={demoCompany} onChange={(event) => setDemoCompany(event.target.value)} maxLength={80} required />
              </label>
              <label>
                E-mail
                <input name="email" type="email" value={demoEmail} onChange={(event) => setDemoEmail(event.target.value)} maxLength={120} required />
              </label>
              {demoProblem ? <p className="org-note">{demoProblem}</p> : null}
              <button className="button primary" type="submit" disabled={demoBusy}>Prøv vores demo</button>
            </form>
          )}
        </section>
        <section id="login">
          <form
            className="login-card"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const typedUsername = String(data.get("username") ?? username).trim();
              const typedPassword = String(data.get("password") ?? password);
              setUsername(typedUsername);
              setPassword(typedPassword);
              setBusy(true);
              setProblem("");
              void onEnter(typedUsername, typedPassword)
                .catch((error: unknown) => {
                  const code = error instanceof ApiError ? error.code : "";
                  setProblem(code === "login" || code === "sign-in"
                    ? "Brugernavn og adgangskode passer ikke sammen."
                    : "Kunne ikke logge ind. Prøv igen.");
                })
                .finally(() => setBusy(false));
            }}
          >
            <BrandMark />
            <h1>Freightlytics</h1>
            <p>Log ind for at åbne arbejdsrummet.</p>
            <label>
              Brugernavn
              <input name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
            </label>
            <label>
              Adgangskode
              <input name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
            </label>
            {problem ? <p className="org-note">{problem}</p> : null}
            <button className="button primary" type="submit" disabled={!ready || busy}>Log ind</button>
          </form>
        </section>
      </main>
    </div>
  );
}

function CoverMotion() {
  return (
    <div className="cover" aria-hidden="true">
      <div className="cover-sheet a"><span /><span /></div>
      <div className="cover-sheet b"><span /><span /></div>
      <div className="cover-sheet c"><span /><span /></div>
      <div className="cover-card"><i /><span /></div>
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
  history, peers, onStart, onExample, onOpen, onHistory, onCoverage,
}: {
  history: StoredAudit[];
  peers: number;
  onStart: () => void;
  onExample: () => void;
  onOpen: (id: string) => void;
  onHistory: () => void;
  onCoverage: () => void;
}) {
  const over = history.reduce((total, audit) => total + audit.summary.overOre, 0);
  const contributed = history.filter((audit) => audit.contributed).length;

  return (
    <div className="content-flow overview">
      <div className="page-intro">
        <span className="eyebrow"><i /> FREIGHTLYTICS ARBEJDSRUM</span>
        <h1>Overblik</h1>
        <p>Kontrollér jeres fragtregninger og følg de afvigelser, I finder.</p>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-label"><span /> GRATIS FAKTURAKONTROL</span>
          <h2>Betaler I den aftalte<br className="desktop-only" /> fragtpris?</h2>
          <p>Indlæs en faktura og jeres prisaftale. Freightlytics sammenholder beløbene og viser, hvad I kan tage op med transportøren.</p>
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
          <p>Lignende prøvefirmaer bag tallene.</p>
          <div className="coverage-mini"><strong>{peers} af 5</strong><span>lignende firmaer</span></div>
          <div className="progress" aria-hidden="true"><div style={{ width: `${peers / 5 * 100}%` }} /></div>
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

function BenchmarkView({ report, orgId, peers }: { report: AuditReport; orgId: string; peers: number }) {
  const gaps = new Map<string, number>();
  const seen = new Set<string>();
  for (const line of report.lines) {
    const service = serviceKey(line.service);
    if (service !== "pakkeshop" && service !== "hjemmelevering") continue;
    const band = WEIGHT_BANDS.find((item) => line.weight <= item.max);
    if (!band || line.differenceOre === null) continue;
    const key = `${service}|${band.key}`;
    seen.add(key);
    if (line.differenceOre > 1) gaps.set(key, (gaps.get(key) ?? 0) + line.differenceOre);
    else if (!gaps.has(key)) gaps.set(key, 0);
  }
  const bands = BENCHMARK_SERVICES.flatMap((service) => WEIGHT_BANDS.map((band) => `${service.key}|${band.key}`));
  const groups = carrierProfiles.map((profile, index) => {
    const key = bands[index];
    return {
      key: profile.name,
      label: profile.name,
      count: carrierPeers(orgId, index),
      over: key ? gaps.get(key) ?? 0 : 0,
      compared: key ? seen.has(key) : true,
    };
  });
  return (
    <div className="content-flow">
      <div className="page-intro">
        <span className="eyebrow"><i /> DANSK INDENRIGS PAKKEFRAGT</span>
        <h1>Datadækning</h1>
        <p>Lignende prøvefirmaer bag tallene. Ikke en markedspris.</p>
      </div>
      <div className="stat-grid two">
        <div className="panel stat"><span>Lignende firmaer</span><strong>{peers} af 5</strong><small>I den samme prøve</small></div>
        <div className="panel stat"><span>Mulig overfakturering</span><strong>{money(report.summary.overOre)}</strong><small>Oktober 2026</small></div>
      </div>
      <section className="panel table-panel">
        <div className="section-heading">
          <h2>Transportører</h2>
          <p>Danmark til Danmark · prøvedata</p>
        </div>
        <div className="cohorts">
          {groups.map((group) => (
            <div className="cohort" key={group.key}>
              <div className="icon-box"><Package size={18} /></div>
              <div><strong>{group.label}</strong></div>
              <div className="cohort-count">
                <span>{group.compared ? money(group.over) : "—"}</span>
                <div className="progress" aria-hidden="true"><div style={{ width: `${group.count / 5 * 100}%` }} /></div>
              </div>
              <span className="status match">{group.count} firmaer</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
