import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight, ArrowUpRight, BarChart3, Bell, Check, ChevronDown, ChevronRight, ClipboardCheck, Copy, Database, FileCheck2,
  FileText, Funnel, History, LayoutGrid, LockKeyhole, Mail, Menu, Package, PanelLeftClose, PanelLeftOpen, Plus, Receipt, RefreshCw,
  Settings, UploadCloud, X,
} from "lucide-react";
import { ApiError, api } from "../api.ts";
import { carrierProfiles } from "../data/carriers.ts";
import { agreementFromCsv, saveAgreements, loadAgreements, sampleAgreement, splitAgreements, todayIso, type Agreement } from "./agreements.ts";
import { MOBILE_NAV, useDrawer, useMedia, useRail } from "./AppNav.tsx";
import { AuditFlow, downloadCsv } from "./audit.tsx";
import { carrierFromMail } from "./carrierName.ts";
import { decodeCsv, importRows, parseCsv, suggestMapping } from "./csv.ts";
import { DEMO_RATES } from "./demo.ts";
import {
  BENCHMARK_SERVICES, WEIGHT_BANDS, serviceKey,
  type AuditIndexEntry, type AuditInput, type AuditReport, type Contribution, type InvoiceRow, type RateRow,
} from "./freight.ts";
import { carrierPeers, loadOrgId, orgAudit, orgFromCompany, orgRateRows, ORGS, peerCount, saveOrgId, type Org } from "./orgs.ts";
import { invoiceCsv, invoicesFromReport, rateCsv, ratesFromReport, type PastSource } from "./past.ts";
import { loadMailFile, saveBlob } from "./mailFiles.ts";
import { ExtractPanel } from "./ExtractPanel.tsx";
import { HeroMotion } from "./HeroMotion.tsx";
import { hashForView, viewFromHash, type WorkspaceView } from "./place.ts";
import { dateLabel, money, ReportView } from "./report.tsx";
import { loadAudits, recordAudit, saveAudits, type StoredAudit } from "./store.ts";
import {
  cacheEpoch, clearWorkspaceCache, mailKey, readMail, readMe, readNotices, readOrgs,
  rememberMail, rememberMe, rememberNotices, rememberOrgs, type CachedMailbox,
} from "./workspaceCache.ts";

const NAV = [
  { id: "overview", label: "Overblik", icon: LayoutGrid },
  { id: "check", label: "Fakturakontrol", icon: ClipboardCheck },
  { id: "coverage", label: "Benchmark", icon: BarChart3 },
  { id: "settings", label: "Indstillinger", icon: Settings },
] as const;

type Company = { id: string; name: string; industry: string; place: string };
type Notice = { id: string; name: string; company: string; email: string; createdAt: string };
type View = WorkspaceView;
type Result = {
  name: string;
  carrier: string;
  report: AuditReport;
  input: AuditInput | null;
  example: boolean;
  saved: AuditIndexEntry | null;
};

let currentUserRequest: Promise<{ user: { role: string } | null }> | null = null;

function loadCurrentUser(): Promise<{ user: { role: string } | null }> {
  if (!currentUserRequest) {
    currentUserRequest = readCurrentUser().finally(() => {
      currentUserRequest = null;
    });
  }
  return currentUserRequest;
}

async function readCurrentUser(): Promise<{ user: { role: string } | null }> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/me", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) return { user: null };
      if (!response.ok) throw new Error("session");
      const body = (await response.json()) as { user?: { role: string } | null };
      return { user: body?.user ?? null };
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("session");
}

function csvHasRows(source: string) {
  return source.split(/\r?\n/).filter((line) => line.trim()).length > 1;
}

function invoiceChoices(org: Org, checks: StoredAudit[], mails: MailRow[]): PastSource[] {
  const fromChecks = checks.flatMap((check) => {
    const stored = check.invoice ?? [];
    const rows = stored.length ? stored : invoicesFromReport(check.report);
    if (!rows.length) return [];
    const sampleFile = check.id.startsWith("sample:") && csvHasRows(org.invoice);
    return [{
      id: `check:${check.id}`,
      name: check.name,
      date: check.createdAt,
      carrier: check.carrier,
      note: "Kontrol",
      csv: sampleFile ? org.invoice : invoiceCsv(rows),
    }];
  });
  const fromMail = mails.flatMap((mail) => mail.files.map((file) => ({
    id: `mail:${file.id}`,
    name: mail.subject || file.filename,
    date: mail.receivedAt,
    carrier: carrierFromMail(mail),
    note: file.filename,
    fileId: file.id,
  })));
  return [...fromChecks, ...fromMail];
}

function orgAgreements(org: Org, saved: Agreement[]): Agreement[] {
  const sample = sampleAgreement(org.id, org.carrier, orgRateRows(org));
  return [...(sample ? [sample] : []), ...saved.filter((item) => item.orgId === org.id)];
}

function rateChoices(org: Org, checks: StoredAudit[], agreements: Agreement[]): PastSource[] {
  const { active, historic } = splitAgreements(agreements, todayIso());
  const agreement: PastSource[] = [...active, ...historic].map((item) => ({
    id: `agreement:${item.id}`,
    name: item.sample ? org.carrier || "Prisaftale" : item.name,
    date: item.from || item.createdAt,
    carrier: item.carrier,
    note: active.includes(item) ? "Aktiv prisaftale" : "Historisk prisaftale",
    csv: item.sample ? org.rates : rateCsv(item.rows),
  }));
  const fromChecks = checks.flatMap((check) => {
    if (check.id.startsWith("sample:")) return [];
    const stored = check.rates ?? [];
    const rows = stored.length ? stored : ratesFromReport(check.report);
    if (!rows.length) return [];
    return [{
      id: `rates:${check.id}`,
      name: check.name,
      date: check.createdAt,
      carrier: check.carrier,
      note: "Kontrol",
      csv: rateCsv(rows),
    }];
  });
  return [...agreement, ...fromChecks];
}

function readPlace(): WorkspaceView {
  if (window.location.hash === "#/historik") {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/fakturakontrol`);
  }
  return viewFromHash(window.location.hash);
}

export function PilotApp() {
  const [view, setView] = useState<View>(() => readPlace());
  const [composer, setComposer] = useState(false);
  const [libraryMail, setLibraryMail] = useState<{ orgId: string; mails: MailRow[] }>({ orgId: "", mails: [] });
  const [result, setResult] = useState<Result | null>(null);
  const [flowKey, setFlowKey] = useState(0);
  const [reportKey, setReportKey] = useState(0);
  const [history, setHistory] = useState<StoredAudit[]>(() => loadAudits());
  const [orgId, setOrgId] = useState(loadOrgId);
  const [extraOrgs, setExtraOrgs] = useState<Company[]>(() => readOrgs() ?? []);
  const [orgsReady, setOrgsReady] = useState(() => {
    const me = readMe();
    if (me === undefined) return false;
    if (me === null || me.role !== "admin") return true;
    return readOrgs() !== undefined;
  });
  const [admin, setAdmin] = useState(() => readMe()?.role === "admin");
  const [notices, setNotices] = useState<Notice[]>(() => readNotices() ?? []);
  const [gate, setGate] = useState<"checking" | "closed" | "open">(() => {
    const me = readMe();
    if (me === undefined) return "checking";
    return me ? "open" : "closed";
  });
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
  const pastInvoices = useMemo(() => {
    const cached = readMail(mailKey(admin, org.id))?.mails;
    const mails = cached ?? (libraryMail.orgId === org.id ? libraryMail.mails : []);
    return invoiceChoices(org, checks, mails);
  }, [admin, org, checks, libraryMail]);
  const [savedAgreements, setSavedAgreements] = useState<Agreement[]>(() => loadAgreements());
  const agreements = useMemo(() => orgAgreements(org, savedAgreements), [org, savedAgreements]);
  const pastRates = useMemo(() => rateChoices(org, checks, agreements), [org, checks, agreements]);
  const inCheck = view === "check" || view === "report" || view === "inbox" || view === "agreements";
  const activeTab = inCheck ? "check" : view;
  const activeLabel = view === "report" ? "Rapport"
    : view === "inbox" ? "Fakturaer"
    : view === "agreements" ? "Prisaftaler"
    : NAV.find((tab) => tab.id === activeTab)?.label;
  const peers = peerCount(org.id);
  const mobile = useMedia(MOBILE_NAV);
  const [railed, toggleRail] = useRail();
  const [navOpen, setNavOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const burger = useRef<HTMLButtonElement>(null);
  const closeNav = useCallback(() => setNavOpen(false), []);
  useDrawer(mobile && navOpen, closeNav, drawer, burger);

  const refreshSession = useCallback(async () => {
    const epoch = cacheEpoch();
    const me = await loadCurrentUser();
    if (cacheEpoch() !== epoch) return "stale" as const;
    if (!me.user) return "out" as const;
    rememberMe(me.user);
    const isAdmin = me.user.role === "admin";
    setAdmin(isAdmin);
    if (isAdmin) {
      const [body, notes] = await Promise.all([
        api<{ orgs: Company[] }>("/api/pilot-orgs").catch(() => null),
        loadNotices(),
      ]);
      if (cacheEpoch() !== epoch) return "stale";
      if (body) {
        rememberOrgs(body.orgs);
        setExtraOrgs(body.orgs);
      }
      if (notes) {
        rememberNotices(notes);
        setNotices(notes);
      }
    } else {
      rememberOrgs([]);
      rememberNotices([]);
      setExtraOrgs([]);
      setNotices([]);
    }
    setGate("open");
    setOrgsReady(true);
    return "in" as const;
  }, []);

  useEffect(() => {
    let alive = true;
    refreshSession()
      .then((result) => {
        if (alive && result === "out") signOut();
      })
      .catch(() => {
        if (alive && readMe() === undefined) {
          setGate("closed");
          setOrgsReady(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [refreshSession]);

  useEffect(() => {
    if (!composer || gate !== "open") return;
    const key = mailKey(admin, org.id);
    const epoch = cacheEpoch();
    const hit = readMail(key);
    setLibraryMail({ orgId: org.id, mails: hit?.mails ?? [] });
    let gone = false;
    const query = admin ? `?company=${encodeURIComponent(org.id)}` : "";
    api<{ address: string; ready: boolean; error?: string; mails: MailRow[] }>(`/api/invoice-mail${query}`)
      .then((body) => {
        if (cacheEpoch() !== epoch) return;
        const previous = readMail(key);
        rememberMail(key, {
          address: body.address || previous?.address || "",
          ready: body.ready,
          error: body.error ?? "",
          mails: body.mails,
        });
        if (!gone) setLibraryMail({ orgId: org.id, mails: body.mails });
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [composer, gate, admin, org.id]);

  useEffect(() => {
    if (view !== "settings" || gate !== "open") return;
    let alive = true;
    refreshSession()
      .then((result) => {
        if (alive && result === "out") signOut();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [view, gate, refreshSession]);

  useEffect(() => {
    if (orgsReady && !orgs.some((item) => item.id === orgId)) setOrgId(ORGS[0].id);
  }, [orgsReady, orgs, orgId]);

  useEffect(() => {
    function onPlace() {
      setView(readPlace());
    }
    window.addEventListener("popstate", onPlace);
    window.addEventListener("hashchange", onPlace);
    return () => {
      window.removeEventListener("popstate", onPlace);
      window.removeEventListener("hashchange", onPlace);
    };
  }, []);

  function navigate(next: View) {
    setNavOpen(false);
    setView(next);
    const hash = hashForView(next);
    const nextUrl = `${window.location.pathname}${window.location.search}${hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentUrl !== nextUrl) window.history.pushState(null, "", nextUrl);
    window.scrollTo({ top: 0 });
  }

  function newAudit() {
    setFlowKey((value) => value + 1);
    setComposer(true);
    if (view !== "check") navigate("check");
  }

  function receiveResult(next: Result) {
    setResult(next);
    setReportKey((value) => value + 1);
    navigate("report");
  }

  function chooseOrg(id: string) {
    if (id !== orgId) {
      const me = readMe();
      const savedOrgs = readOrgs();
      const savedNotices = readNotices();
      clearWorkspaceCache();
      if (me !== undefined) rememberMe(me);
      if (savedOrgs) rememberOrgs(savedOrgs);
      if (savedNotices) rememberNotices(savedNotices);
    }
    setOrgId(id);
    saveOrgId(id);
    setResult(null);
    if (view === "report") navigate("overview");
  }

  function signOut() {
    clearWorkspaceCache();
    setAdmin(false);
    setExtraOrgs([]);
    setNotices([]);
    setOrgsReady(true);
    setGate("closed");
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
    navigate("check");
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
    rememberMe(signed.user);
    setAdmin(isAdmin);
    if (isAdmin) {
      const [body, notes] = await Promise.all([
        api<{ orgs: Company[] }>("/api/pilot-orgs").catch(() => null),
        loadNotices(),
      ]);
      if (body) {
        rememberOrgs(body.orgs);
        setExtraOrgs(body.orgs);
      }
      if (notes) {
        rememberNotices(notes);
        setNotices(notes);
      }
    } else {
      rememberOrgs([]);
      rememberNotices([]);
      setExtraOrgs([]);
      setNotices([]);
    }
    setGate("open");
  }

  async function refreshNotices() {
    if (!admin) return;
    const notes = await loadNotices();
    if (!notes) return;
    rememberNotices(notes);
    setNotices(notes);
  }

  async function dismissNotice(id: string) {
    setNotices((current) => {
      const next = current.filter((item) => item.id !== id);
      rememberNotices(next);
      return next;
    });
    await api(`/api/notifications/${encodeURIComponent(id)}/seen`, { method: "POST" }).catch(() => undefined);
  }

  if (gate === "checking") {
    return (
      <div className="session-loading" role="status" aria-live="polite">
        <BrandMark />
        <p>Henter arbejdsrummet</p>
      </div>
    );
  }

  if (gate !== "open") {
    return <SignedOut ready={gate === "closed"} onEnter={enter} />;
  }

  const orgSwitch = (
    <OrgSwitch
      admin={admin}
      org={org}
      orgs={orgs}
      created={extraOrgs}
      onChange={(id) => { chooseOrg(id); setNavOpen(false); }}
      onUpdated={(updated) => {
        setExtraOrgs((current) => {
          const next = current.map((item) => item.id === updated.id ? updated : item);
          rememberOrgs(next);
          return next;
        });
      }}
      onRemoved={(id) => {
        setExtraOrgs((current) => {
          const next = current.filter((item) => item.id !== id);
          rememberOrgs(next);
          return next;
        });
        if (orgId === id) chooseOrg(ORGS[0].id);
      }}
      onSignedOut={signOut}
    />
  );

  return (
    <div className={["app-shell", railed ? "railed" : "", navOpen ? "nav-open" : ""].filter(Boolean).join(" ")}>
      <aside
        className="sidebar"
        id="app-sidebar"
        ref={drawer}
        inert={mobile && !navOpen}
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile && navOpen ? true : undefined}
        aria-label={mobile ? "Menu" : undefined}
      >
        <div className="sidebar-head">
          <button className="brand" type="button" onClick={() => navigate("overview")} aria-label="Freightlytics overblik" data-tip="Overblik">
            <BrandMark onDark />
            <span className="nav-label">Freightlytics<span className="brand-sub">FRAGTØKONOMI</span></span>
          </button>
          {mobile ? (
            <button type="button" className="drawer-close" aria-label="Luk menu" onClick={closeNav}><X size={20} /></button>
          ) : null}
        </div>
        {mobile ? (
          <div className="drawer-org">
            <div className="workspace-label">ORGANISATION</div>
            {orgSwitch}
          </div>
        ) : null}
        <div className="workspace-label">ARBEJDSRUM</div>
        <nav aria-label="Hovedmenu">
          {NAV.map(({ id, label, icon: Icon }) => (
            <Fragment key={id}>
              <button
                type="button"
                className={view === id || (id === "check" && view === "report") ? "nav-item active" : activeTab === id ? "nav-item section" : "nav-item"}
                aria-current={view === id || (id === "check" && view === "report") ? "page" : undefined}
                data-tip={label}
                onClick={() => navigate(id)}
              >
                <Icon size={19} /><span className="nav-label">{label}</span>
              </button>
              {id === "check" ? (
                <div className="nav-sub">
                  <button type="button" className={view === "inbox" ? "active" : ""} aria-current={view === "inbox" ? "page" : undefined} data-tip="Fakturaer" onClick={() => navigate("inbox")}>
                    <Receipt size={15} /><span className="nav-label">Fakturaer</span>
                  </button>
                  <button type="button" className={view === "agreements" ? "active" : ""} aria-current={view === "agreements" ? "page" : undefined} data-tip="Prisaftaler" onClick={() => navigate("agreements")}>
                    <FileText size={15} /><span className="nav-label">Prisaftaler</span>
                  </button>
                </div>
              ) : null}
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="pilot-card">
            <div className="sidebar-icon"><Package size={17} /></div>
            <div className="nav-label"><strong>Dansk pakkefragt</strong><span>Pilot · Version 1</span></div>
          </div>
          <div className="sidebar-private"><LockKeyhole size={13} /><span className="nav-label">Privat arbejdsrum</span></div>
          {mobile ? null : (
            <button
              type="button"
              className="rail-toggle"
              aria-controls="app-sidebar"
              aria-expanded={!railed}
              aria-label={railed ? "Udvid menu" : "Skjul menu"}
              data-tip="Udvid menu"
              onClick={toggleRail}
            >
              {railed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
              <span className="nav-label">Skjul menu</span>
            </button>
          )}
        </div>
      </aside>
      {mobile ? <div className="nav-backdrop" aria-hidden="true" onClick={closeNav} /> : null}

      <div className="workspace-main" inert={mobile && navOpen}>
        <header className="topbar">
          <button
            ref={burger}
            type="button"
            className="burger"
            aria-label="Åbn menu"
            aria-controls="app-sidebar"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <Menu size={21} />
          </button>
          <button type="button" className="topbar-brand" aria-label="Freightlytics overblik" onClick={() => navigate("overview")}>
            <BrandMark />
            <span>Freightlytics</span>
          </button>
          <div className="breadcrumb"><span>Arbejdsrum</span><ChevronRight size={14} /><strong>{activeLabel}</strong></div>
          <div className="topbar-right">
            {mobile ? null : orgSwitch}
            <NoticeBell notices={notices} onDismiss={(id) => void dismissNotice(id)} onRefresh={() => void refreshNotices()} />
            <AccountMenu
              admin={admin}
              onCreated={(created) => {
                setExtraOrgs((current) => {
                  const next = [...current.filter((item) => item.id !== created.id), created];
                  rememberOrgs(next);
                  return next;
                });
                chooseOrg(created.id);
              }}
              onSignedOut={signOut}
            />
          </div>
        </header>

        <main className="main-content">
          {view === "overview" ? (
            <Overview
              history={checks}
              peers={peers}
              onStart={newAudit}
              onExample={demo}
              onOpen={openReport}
              onChecks={() => navigate("check")}
              onCoverage={() => navigate("coverage")}
            />
          ) : null}
          {view === "check" ? (
            <ChecksPage checks={checks} onStart={newAudit} onOpen={openReport} />
          ) : null}
          {view === "inbox" ? <InvoicesView key={org.id} admin={admin} orgId={org.id} orgs={orgs} /> : null}
          {view === "agreements" ? (
            <AgreementsView
              org={org}
              agreements={agreements}
              onChange={(next) => {
                setSavedAgreements((current) => {
                  const others = current.filter((item) => item.orgId !== org.id);
                  const merged = [...others, ...next.filter((item) => !item.sample)];
                  saveAgreements(merged);
                  return merged;
                });
              }}
            />
          ) : null}
          {view === "report" && result ? (
            <ReportView
              key={reportKey}
              {...result}
              onBack={() => navigate(result.example ? "overview" : "check")}
              onSave={saveReport}
              onRemove={removeReport}
              onRevoke={revokeContribution}
            />
          ) : null}
          {view === "coverage" ? <BenchmarkView report={sampleReport} orgId={org.id} peers={peers} /> : null}
          {view === "settings" ? <SettingsView key={org.id} admin={admin} orgId={org.id} orgs={orgs} /> : null}
        </main>
        {composer ? (
          <Modal title="Nyt fakturatjek" audit onClose={() => setComposer(false)}>
            <AuditFlow
              key={flowKey}
              embedded
              companyId={org.id}
              invoices={pastInvoices}
              rates={pastRates}
              onExample={() => { setComposer(false); demo(); }}
              onReport={(input, report) => {
                setComposer(false);
                receiveResult({
                  name: input.name, carrier: input.carrier, input, report, example: false, saved: null,
                });
              }}
            />
          </Modal>
        ) : null}
        <footer className="main-footer"><span>Freightlytics</span><span>Privat pilot · Dansk indenrigs pakkefragt</span></footer>
      </div>
    </div>
  );
}

type MailFile = { id: string; filename: string; bytes: number; carrier?: string };
type MailRow = { id: string; sender: string; subject: string; receivedAt: string; files: MailFile[] };

const isPdfName = (name: string) => name.toLowerCase().endsWith(".pdf");

function invoiceFiles(mail: MailRow): MailFile[] {
  return [...mail.files].sort((left, right) => Number(isPdfName(right.filename)) - Number(isPdfName(left.filename)));
}

async function copyText(value: string, field: HTMLInputElement | null) {
  field?.select();
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    field?.focus();
  }
}

function SettingsView({ admin, orgId, orgs }: { admin: boolean; orgId: string; orgs: { id: string; name: string }[] }) {
  const key = mailKey(admin, orgId);
  const cached = readMail(key);
  const [address, setAddress] = useState(cached?.address ?? "");
  const [ready, setReady] = useState(cached?.ready ?? true);
  const [loading, setLoading] = useState(!cached);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState(cached?.error ?? "");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const hit = readMail(key);
    const epoch = cacheEpoch();
    let gone = false;
    if (!hit) {
      setAddress("");
      setReady(true);
      setProblem("");
      setLoading(true);
    }
    setCopied(false);
    const query = admin ? `?company=${encodeURIComponent(orgId)}` : "";
    api<{ address: string; ready: boolean; error?: string; mails: MailRow[] }>(`/api/invoice-mail${query}`)
      .then((body) => {
        if (cacheEpoch() !== epoch) return;
        const next: CachedMailbox = {
          address: body.address,
          ready: body.ready,
          error: body.error ?? "",
          mails: body.mails,
        };
        rememberMail(key, next);
        if (gone) return;
        setAddress(next.address);
        setReady(next.ready);
        setProblem(next.error);
      })
      .catch(() => {
        if (gone || cacheEpoch() !== epoch || readMail(key)) return;
        setProblem("Kunne ikke hente indbakken.");
      })
      .finally(() => {
        if (!gone && cacheEpoch() === epoch) setLoading(false);
      });
    return () => {
      gone = true;
    };
  }, [admin, orgId, key]);

  const shownAddress = address || (orgId ? `${orgId}@freightlytics.io` : "");
  const mailboxId = shownAddress.split("@")[0] ?? "";
  const ownerName = orgs.find((item) => item.id === mailboxId)?.name ?? "";

  async function copyAddress() {
    field.current?.select();
    try {
      await navigator.clipboard.writeText(shownAddress);
    } catch {
      field.current?.focus();
    }
    setCopied(true);
  }
  return (
    <div className="content-flow">
      <div className="page-intro">
        <span className="eyebrow"><i /> ORGANISATION</span>
        <h1>Indstillinger</h1>
        <p>Bed transportøren om at sætte adressen på som CC. Vedhæftningerne gemmes kun på {ownerName || "denne organisation"} og vises under Fakturakontrol.</p>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>Fakturamail</h2>
          <p>{loading || !problem ? (ready || loading ? "Mail til adressen lander under Fakturaer." : "Adressen kan kopieres. Vedhæftninger gemmes, når indbakken er sat op.") : "Indbakken kunne ikke læses."}</p>
        </div>
        <div className="mail-address" style={{ padding: "0 18px 18px" }}>
          {loading && !shownAddress ? <span className="bone address" /> : (
            <input ref={field} readOnly value={shownAddress} aria-label="Indbakke" spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
          )}
          <button className="button secondary" type="button" onClick={() => void copyAddress()} disabled={!shownAddress}>{copied ? "Kopieret" : "Kopiér"}</button>
        </div>
      </section>
    </div>
  );
}

function InvoicesView({ admin, orgId, orgs }: { admin: boolean; orgId: string; orgs: { id: string; name: string }[] }) {
  const key = mailKey(admin, orgId);
  const cached = readMail(key);
  const [mails, setMails] = useState<MailRow[]>(cached?.mails ?? []);
  const [address, setAddress] = useState(cached?.address ?? "");
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState(cached?.error ?? "");
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<{ subject: string; files: MailFile[]; fileId: string } | null>(null);
  const [fetching, setFetching] = useState<{ fileId: string; percent: number | null } | null>(null);
  const reload = useRef<(manual: boolean) => void>(() => undefined);
  const addressField = useRef<HTMLInputElement>(null);
  const ownerName = orgs.find((item) => item.id === orgId)?.name ?? "";
  const shownAddress = address || `${orgId}@freightlytics.io`;
  useEffect(() => {
    setOpen(null);
    const epoch = cacheEpoch();
    let gone = false;
    async function load(manual: boolean) {
      const hit = readMail(key);
      if (!hit && !manual) setLoading(true);
      if (manual) setRefreshing(true);
      const query = admin ? `?company=${encodeURIComponent(orgId)}` : "";
      try {
        const body = await api<{ address: string; ready: boolean; error?: string; mails: MailRow[] }>(`/api/invoice-mail${query}`);
        if (cacheEpoch() !== epoch) return;
        const previous = readMail(key);
        const next: CachedMailbox = {
          address: body.address || previous?.address || "",
          ready: body.ready,
          error: body.error ?? "",
          mails: body.mails,
        };
        rememberMail(key, next);
        if (gone) return;
        setMails(next.mails);
        setAddress(next.address);
        setProblem(next.error);
      } catch {
        if (gone || cacheEpoch() !== epoch || readMail(key)) return;
        setProblem("Kunne ikke hente fakturaerne.");
      } finally {
        if (!gone && cacheEpoch() === epoch) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    const hit = readMail(key);
    if (hit) {
      setMails(hit.mails);
      setAddress(hit.address);
      setProblem(hit.error);
      setLoading(false);
    }
    reload.current = (manual) => { void load(manual); };
    void load(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 20000);
    function onVisible() {
      if (document.visibilityState === "visible") void load(false);
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [admin, orgId, key]);

  const carriers = [...new Set(mails.map(carrierFromMail).filter(Boolean))].sort((a, b) => a.localeCompare(b, "da"));
  const unknown = mails.some((mail) => !carrierFromMail(mail));
  const shown = mails.filter((mail) => {
    const carrier = carrierFromMail(mail);
    if (!filter) return true;
    if (filter === "ukendt") return !carrier;
    return carrier === filter;
  });
  const openFile = open?.files.find((file) => file.id === open.fileId) ?? null;

  function openMail(mail: MailRow) {
    const files = invoiceFiles(mail);
    setOpen({ subject: mail.subject, files, fileId: files[0]?.id ?? "" });
  }

  function added(mail: MailRow) {
    setAdding(false);
    setFilter("");
    setMails((current) => {
      const next = [mail, ...current.filter((item) => item.id !== mail.id)];
      const previous = readMail(key);
      rememberMail(key, { address: previous?.address ?? address, ready: true, error: "", mails: next });
      return next;
    });
    setProblem("");
    openMail(mail);
  }

  async function copyAddress() {
    await copyText(shownAddress, addressField.current);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function downloadOpen() {
    if (!openFile) return;
    const fileId = openFile.id;
    const filename = openFile.filename.split(/[/\\]/).pop() || "faktura.pdf";
    const load = loadMailFile(fileId, orgId);
    if (load.blob) {
      saveBlob(load.blob, filename);
      return;
    }
    const show = () => setFetching({ fileId, percent: load.total ? Math.min(99, Math.floor((load.loaded / load.total) * 100)) : null });
    show();
    const stop = load.subscribe(show);
    try {
      const blob = await load.promise;
      saveBlob(blob, filename);
      setFetching({ fileId, percent: 100 });
      window.setTimeout(() => setFetching((now) => (now?.fileId === fileId && now.percent === 100 ? null : now)), 1200);
    } catch {
      setFetching({ fileId, percent: -1 });
    } finally {
      stop();
    }
  }

  return (
    <div className="content-flow">
      <div className="page-intro split">
        <div>
          <span className="eyebrow"><i /> FAKTURAKONTROL</span>
          <h1>Fakturaer</h1>
          <p>Fakturaer til {ownerName || "organisationen"}, sendt til fakturamailen eller tilføjet her. Listen opdateres af sig selv, mens siden er åben.</p>
        </div>
        <button className="button primary" type="button" onClick={() => setAdding(true)}><Plus size={18} /> Tilføj faktura</button>
      </div>
      <section className="panel mailbox-card" aria-label="Fakturamail">
        <div className="mailbox-icon"><Mail size={20} /></div>
        <div className="mailbox-body">
          <span className="mailbox-label">Fakturamail</span>
          <input
            ref={addressField}
            className="mailbox-address"
            readOnly
            value={shownAddress}
            aria-label="Fakturamail"
            spellCheck={false}
            size={Math.max(16, shownAddress.length)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <small>Bed transportøren sende fakturaen hertil eller sætte adressen på som CC. Vedhæftningen gemmes kun på {ownerName || "organisationen"}.</small>
        </div>
        <button className="button secondary" type="button" onClick={() => void copyAddress()}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Kopieret" : "Kopiér"}
        </button>
      </section>
      <section className="panel" aria-busy={loading}>
        <div className="section-heading list-heading">
          <div>
            <h2>Alle fakturaer</h2>
            <p>{loading ? "Henter" : `${shown.length} ${shown.length === 1 ? "faktura" : "fakturaer"}${filter ? ` · ${filter === "ukendt" ? "ukendt transportør" : filter}` : ""}`}</p>
          </div>
          <div className="list-tools">
            <CarrierFilter value={filter} carriers={carriers} unknown={unknown} onChange={setFilter} />
            <button className="tool-button" type="button" aria-label={refreshing ? "Opdaterer" : "Opdater"} data-tip="Opdater" onClick={() => reload.current(true)} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? "spin" : undefined} />
            </button>
          </div>
        </div>
        {loading ? <MailSkeleton /> : problem ? <p className="org-note" style={{ padding: "0 18px 16px" }}>{problem}</p> : shown.length === 0 ? (
          <p className="quiet" style={{ padding: "0 18px 16px" }}>{mails.length === 0 ? "Ingen fakturaer endnu. Send en til fakturamailen, eller tilføj den her." : "Ingen fakturaer for den transportør."}</p>
        ) : (
          <>
            <div className="mail-head"><span>Emne</span><span>Transportør</span><span className="mail-file">Fil</span></div>
            <ul className="mail-list">
              {shown.map((mail) => {
                const files = invoiceFiles(mail);
                const carrier = carrierFromMail(mail);
                return (
                  <li key={mail.id}>
                    <button type="button" className="mail-row" onClick={() => openMail(mail)}>
                      <span>
                        <strong>{mail.subject}</strong>
                        <small>{mail.sender} · {dateLabel(mail.receivedAt)}</small>
                      </span>
                      <span className="mail-carrier">{carrier || "—"}</span>
                      <span className="mail-file">{files[0]?.filename ?? "Ingen fil"}{files.length > 1 ? ` +${files.length - 1}` : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      {adding ? <AddInvoiceModal orgId={orgId} onClose={() => setAdding(false)} onAdded={added} /> : null}
      {open ? (
        <Modal title={open.subject} wide onClose={() => setOpen(null)}>
          {open.files.length > 1 ? (
            <div className="invoice-files">
              {open.files.map((file) => (
                <button key={file.id} type="button" className={file.id === open.fileId ? "active" : ""} onClick={() => setOpen({ ...open, fileId: file.id })}>{file.filename}</button>
              ))}
            </div>
          ) : null}
          {openFile ? (
            <>
              <div className="invoice-toolbar">
                {fetching?.fileId === openFile.id ? <DownloadProgress percent={fetching.percent} /> : null}
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void downloadOpen()}
                  disabled={fetching?.fileId === openFile.id && fetching.percent !== -1 && fetching.percent !== 100}
                >Hent</button>
              </div>
              {isPdfName(openFile.filename) ? (
                <>
                  <ExtractPanel fileId={openFile.id} companyId={orgId} />
                  <InvoicePages fileId={openFile.id} companyId={orgId} />
                </>
              ) : <SheetPreview key={openFile.id} file={openFile} companyId={orgId} />}
            </>
          ) : <p>Denne faktura har ingen fil.</p>}
        </Modal>
      ) : null}
    </div>
  );
}

function CarrierFilter({ value, carriers, unknown, onChange }: {
  value: string;
  carriers: string[];
  unknown: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const options = [
    { id: "", label: "Alle transportører" },
    ...carriers.map((name) => ({ id: name, label: name })),
    ...(unknown ? [{ id: "ukendt", label: "Ukendt transportør" }] : []),
  ];
  return (
    <div className="filter-menu" ref={root}>
      <button
        type="button"
        className={value ? "tool-button active" : "tool-button"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={value ? `Filter: ${value === "ukendt" ? "ukendt transportør" : value}` : "Filtrér på transportør"}
        data-tip="Filtrér"
        onClick={() => setOpen((current) => !current)}
      >
        <Funnel size={16} />
        {value ? <span className="tool-dot" /> : null}
      </button>
      {open ? (
        <div className="filter-pop" role="menu" aria-label="Transportør">
          <p className="filter-title">Transportør</p>
          {options.map((option) => (
            <button
              key={option.id || "alle"}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.id}
              onClick={() => { onChange(option.id); setOpen(false); }}
            >
              <span>{option.label}</span>
              {value === option.id ? <Check size={15} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const UPLOAD_ACCEPT = ".pdf,.csv,.tsv,.txt,.xml,.xls,.xlsx,application/pdf,text/csv,text/tab-separated-values,text/plain";

function AddInvoiceModal({ orgId, onClose, onAdded }: { orgId: string; onClose: () => void; onAdded: (mail: MailRow) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setProblem("");
    if (!/\.(pdf|csv|tsv|txt|xml|xls|xlsx)$/i.test(file.name)) {
      setProblem("Vælg en PDF, CSV, TSV, TXT, XML eller Excel-fil.");
      return;
    }
    if (file.size > 8_000_000) {
      setProblem("Filen må fylde højst 8 MB.");
      return;
    }
    setBusy(true);
    try {
      const body = await api<{ mail: MailRow }>(
        `/api/invoice-mail/upload?company=${encodeURIComponent(orgId)}&name=${encodeURIComponent(file.name.slice(0, 120))}`,
        { method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" } },
      );
      onAdded(body.mail);
    } catch (error) {
      const message = error instanceof ApiError && error.message !== error.code ? error.message : "";
      setProblem(message || "Fakturaen blev ikke gemt. Prøv igen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Tilføj faktura" onClose={() => { if (!busy) onClose(); }}>
      <p>Fakturaen gemmes under Fakturaer som en modtaget mail. En PDF læses derefter af Workers AI. En CSV læses i browseren, når den åbnes.</p>
      <div
        className={`drop-zone add-drop ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file && !busy) void upload(file);
        }}
      >
        <input
          ref={input}
          className="sr-only"
          type="file"
          tabIndex={-1}
          accept={UPLOAD_ACCEPT}
          aria-label="Vælg fakturafil"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void upload(file);
          }}
        />
        <div className="drop-icon"><UploadCloud size={23} /></div>
        {busy ? <span role="status">Gemmer fakturaen…</span> : (
          <>
            <button type="button" className="text-button" onClick={() => input.current?.click()}>Vælg fil</button>
            <span>eller slip den her · PDF, CSV, TSV, TXT, XML eller Excel · maks. 8 MB</span>
          </>
        )}
      </div>
      {problem ? <p className="org-note" role="alert">{problem}</p> : null}
    </Modal>
  );
}

function SheetPreview({ file, companyId }: { file: MailFile; companyId: string }) {
  const [state, setState] = useState<{ rows?: InvoiceRow[]; error?: string } | null>(null);
  const sheetFile = /\.(csv|tsv|txt)$/i.test(file.filename);
  useEffect(() => {
    if (!sheetFile) return;
    let gone = false;
    loadMailFile(file.id, companyId).promise
      .then(async (blob) => {
        const sheet = parseCsv(decodeCsv(await blob.arrayBuffer()));
        const rows = importRows("invoice", sheet, suggestMapping("invoice", sheet.headers));
        if (!gone) setState({ rows });
      })
      .catch((error: unknown) => {
        if (!gone) setState({ error: (error as Error).message });
      });
    return () => { gone = true; };
  }, [file.id, companyId, sheetFile]);
  if (!sheetFile) return <p className="quiet">Filen vises ikke her. Hent den, eller gem den som CSV.</p>;
  if (!state) return <p>Læser filen…</p>;
  if (state.error || !state.rows) {
    return <p className="org-note">Linjerne kunne ikke læses automatisk: {state.error} Vælg filen i Nyt fakturatjek for at tilknytte kolonnerne.</p>;
  }
  const total = state.rows.reduce((sum, row) => sum + row.billedOre, 0);
  return (
    <section className="extract-panel" aria-label="Fakturalinjer fra filen">
      <div className="extract-head"><div><h3><FileText size={15} /> Fakturalinjer</h3><p>Læst i browseren fra {file.filename}</p></div></div>
      <div className="rate-scroll">
        <table className="rate-table extract-table">
          <thead><tr><th>Forsendelse</th><th>Dato</th><th>Service</th><th>Vægt</th><th className="num">Beløb</th></tr></thead>
          <tbody>
            {state.rows.map((row, index) => (
              <tr key={`${row.shipment}-${index}`}>
                <td>{row.shipment}</td>
                <td>{dateLabel(row.date)}</td>
                <td>{row.service}</td>
                <td>{row.weight.toLocaleString("da-DK")} kg</td>
                <td className="num">{money(row.billedOre)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={4}>Linjesum</td><td className="num">{money(total)}</td></tr></tfoot>
        </table>
      </div>
    </section>
  );
}

function DownloadProgress({ percent }: { percent: number | null }) {
  const label = percent === null ? "Initialiserer…" : percent === -1 ? "Kunne ikke hente filen" : percent === 100 ? "Hentet" : `Henter ${percent} %`;
  return (
    <div className="download-progress" role="status" aria-live="polite">
      <span>{label}</span>
      {percent === -1 ? null : (
        <div className={percent === null ? "download-bar busy" : "download-bar"} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          <i style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

function MailSkeleton() {
  return (
    <ul className="mail-list" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <li key={row}>
          <div className="mail-row mail-skeleton">
            <span>
              <i className="bone title" />
              <i className="bone meta" />
            </span>
            <i className="bone carrier" />
            <i className="bone file" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function InvoicePages({ fileId, companyId }: { fileId: string; companyId: string }) {
  const [images, setImages] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "empty">("loading");
  useEffect(() => {
    let gone = false;
    let task: { destroy: () => Promise<void> } | null = null;
    setState("loading");
    setImages([]);
    void (async () => {
      const blob = await loadMailFile(fileId, companyId).promise;
      const data = new Uint8Array(await blob.arrayBuffer());
      if (String.fromCharCode(...data.subarray(0, 5)) !== "%PDF-") {
        if (!gone) setState("empty");
        return;
      }
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const loading = pdfjs.getDocument({ data });
      task = loading;
      const document = await loading.promise;
      const urls: string[] = [];
      for (let number = 1; number <= document.numPages; number += 1) {
        if (gone) return;
        const page = await document.getPage(number);
        const viewport = page.getViewport({ scale: 1.35 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        urls.push(canvas.toDataURL("image/png"));
        page.cleanup();
      }
      if (!gone) {
        setImages(urls);
        setState(urls.length ? "ready" : "empty");
      }
    })().catch(() => {
      if (!gone) setState("missing");
    });
    return () => {
      gone = true;
      void task?.destroy();
    };
  }, [fileId, companyId]);
  if (state === "loading") return <p>Henter faktura…</p>;
  if (state === "empty") return <p>Denne mail har ingen PDF.</p>;
  if (state !== "ready") return <p>Kunne ikke vise fakturaen.</p>;
  return (
    <div className="invoice-scroll">
      {images.map((src, index) => (
        <img key={`${fileId}-${index}`} src={src} alt={`Side ${index + 1}`} />
      ))}
    </div>
  );
}

function NoticeBell({ notices, onDismiss, onRefresh }: {
  notices: Notice[];
  onDismiss: (id: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const unread = notices.length;
  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="notice-bell" ref={root}>
      <button
        type="button"
        className="bell-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Beskeder, ${unread} ulæste` : "Beskeder"}
        onClick={() => {
          setOpen((value) => {
            if (!value) onRefresh();
            return !value;
          });
        }}
      >
        <Bell size={16} />
        {unread ? <span className="bell-dot" /> : null}
      </button>
      {open ? (
        <div className="notice-pop" role="dialog" aria-label="Beskeder">
          <p className="notice-pop-title">Beskeder</p>
          {unread === 0 ? <p className="notice-empty">Ingen beskeder.</p> : (
            <ul>
              {notices.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>Demoønske</strong>
                    <p>{item.name} · {item.company}</p>
                    <p>{item.email}</p>
                    <small>{dateLabel(item.createdAt)}</small>
                  </div>
                  <button type="button" onClick={() => onDismiss(item.id)}>Læst</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
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
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setCreating(true); setName(""); setIndustry(""); setPlace(""); setProblem(""); }}>Opret organisation</button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => void logout()}>Log ud</button>
        </div>
      ) : null}
      {admin && creating ? (
        <Modal title="Opret organisation" onClose={() => { if (!busy) setCreating(false); }}>
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
        </Modal>
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

async function loadNotices(): Promise<Notice[] | null> {
  try {
    const body = await api<{ notifications: Notice[] }>("/api/notifications");
    return body.notifications;
  } catch {
    return null;
  }
}

function clearHash(hash: string) {
  if (window.location.hash === hash) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
}

function Modal({ title, onClose, children, wide = false, audit = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; audit?: boolean }) {
  const close = useRef(onClose);
  close.current = onClose;
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (card.current?.querySelector<HTMLElement>("input:not([tabindex='-1']), select:not([tabindex='-1']), textarea") ?? card.current?.querySelector<HTMLElement>("button:not(.modal-close)"))?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
    }
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close.current(); }}>
      <div className={["modal-card", wide ? "invoice-modal" : "", audit ? "audit-modal" : ""].filter(Boolean).join(" ")} ref={card} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="modal-close" onClick={() => close.current()}>Luk</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SignedOut({ ready, onEnter }: { ready: boolean; onEnter: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoName, setDemoName] = useState("");
  const [demoCompany, setDemoCompany] = useState("");
  const [demoEmail, setDemoEmail] = useState("");
  const [demoProblem, setDemoProblem] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  useEffect(() => {
    document.title = "Freightlytics";
    const hash = window.location.hash;
    if (hash === "#/login" || hash === "#login") setLoginOpen(true);
    if (hash === "#/demo" || hash === "#demo") setDemoOpen(true);
  }, []);

  function closeLogin() {
    setLoginOpen(false);
    clearHash("#login");
    clearHash("#/login");
  }

  function closeDemo() {
    setDemoOpen(false);
    clearHash("#demo");
    clearHash("#/demo");
  }

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
          <button type="button" className="bar-link" onClick={() => setDemoOpen(true)}>Prøv demo</button>
          <button type="button" className="button primary" onClick={() => setLoginOpen(true)}>Log ind</button>
        </nav>
      </header>
      <main id="top">
        <section className="marketing-hero">
          <div>
            <h1>Betaler I den aftalte fragtpris?</h1>
            <p>Sammenhold fakturaen med prisaftalen. Se afvigelsen i kroner, og hvad I kan tage op med transportøren.</p>
            <div className="actions">
              <button type="button" className="button primary" onClick={() => setDemoOpen(true)}>Prøv vores demo</button>
              <button type="button" className="button secondary" onClick={() => setLoginOpen(true)}>Log ind</button>
            </div>
          </div>
          <HeroMotion />
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
      </main>
      {demoOpen ? (
        <Modal title="Prøv vores demo" onClose={closeDemo}>
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
        </Modal>
      ) : null}
      {loginOpen ? (
        <Modal title="Log ind" onClose={closeLogin}>
          <p>Log ind for at åbne arbejdsrummet.</p>
          <form
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
                  const detail = error instanceof Error ? error.message : "";
                  setProblem(code === "database" && detail && detail !== "database"
                    ? detail
                    : code === "login" || code === "sign-in"
                      ? "Brugernavn og adgangskode passer ikke sammen."
                      : "Kunne ikke logge ind. Prøv igen.");
                })
                .finally(() => setBusy(false));
            }}
          >
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
        </Modal>
      ) : null}
    </div>
  );
}

function BrandMark({ onDark = false }: { onDark?: boolean }) {
  return <img className="brand-mark" src={onDark ? "/logo-dark.svg" : "/logo.svg"} alt="" aria-hidden="true" width="56" height="37" />;
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
  history, peers, onStart, onExample, onOpen, onChecks, onCoverage,
}: {
  history: StoredAudit[];
  peers: number;
  onStart: () => void;
  onExample: () => void;
  onOpen: (id: string) => void;
  onChecks: () => void;
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
            <button className="text-button muted" type="button" onClick={onChecks}>Fakturakontrol <ChevronRight size={16} /></button>
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

function ChecksPage({ checks, onStart, onOpen }: {
  checks: StoredAudit[];
  onStart: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="content-flow">
      <div className="page-intro split">
        <div>
          <span className="eyebrow"><i /> GEMTE RAPPORTER</span>
          <h1>Fakturakontrol</h1>
          <p>Åbn tidligere kontroller og administrér dine databidrag.</p>
        </div>
        <button className="button primary" type="button" onClick={onStart}><Plus size={18} /> Nyt fakturatjek</button>
      </div>
      <section className="panel history-panel">
        <div className="section-heading"><h2>Seneste kontroller</h2><p>{checks.length} kontroller</p></div>
        <HistoryRows items={checks} onOpen={onOpen} onStart={onStart} />
      </section>
    </div>
  );
}

function AgreementsView({ org, agreements, onChange }: { org: Org; agreements: Agreement[]; onChange: (next: Agreement[]) => void }) {
  const [adding, setAdding] = useState(false);
  const today = todayIso();
  const { active, historic } = splitAgreements(agreements, today);
  const [expanded, setExpanded] = useState<string>(() => active[0]?.id ?? "");

  function setEnded(id: string, ended: boolean) {
    onChange(agreements.map((item) => item.id === id ? { ...item, ended: ended ? new Date().toISOString() : undefined } : item));
  }

  function remove(id: string) {
    onChange(agreements.filter((item) => item.id !== id));
  }

  const list = (items: Agreement[], state: "active" | "historic") => items.length === 0 ? (
    <p className="quiet agreement-empty">{state === "active" ? `Ingen aktive prisaftaler for ${org.name}.` : "Ingen historiske prisaftaler."}</p>
  ) : (
    <ul className="agreement-list">
      {items.map((item) => (
        <AgreementRow
          key={item.id}
          agreement={item}
          state={state}
          open={expanded === item.id}
          onToggle={() => setExpanded((current) => current === item.id ? "" : item.id)}
          onEnd={() => setEnded(item.id, true)}
          onRestore={() => setEnded(item.id, false)}
          onRemove={() => remove(item.id)}
        />
      ))}
    </ul>
  );

  return (
    <div className="content-flow">
      <div className="page-intro split">
        <div>
          <span className="eyebrow"><i /> FAKTURAKONTROL</span>
          <h1>Prisaftaler</h1>
          <p>Aftaler for {org.name}. En aftale bliver historisk, når den udløber, når en nyere aftale med samme transportør træder i kraft, eller når du afslutter den.</p>
        </div>
        <button className="button primary" type="button" onClick={() => setAdding(true)}><Plus size={18} /> Tilføj prisaftale</button>
      </div>
      <section className="panel">
        <div className="section-heading"><h2><span className="state-dot active" aria-hidden="true" /> Aktive prisaftaler</h2><p>{active.length} {active.length === 1 ? "aftale" : "aftaler"} · bruges i nye fakturatjek</p></div>
        {list(active, "active")}
      </section>
      <section className="panel">
        <div className="section-heading"><h2><span className="state-dot historic" aria-hidden="true" /> Historiske prisaftaler</h2><p>{historic.length} {historic.length === 1 ? "aftale" : "aftaler"} · kan stadig vælges til ældre fakturaer</p></div>
        {list(historic, "historic")}
      </section>
      {adding ? (
        <AddAgreementModal
          org={org}
          onClose={() => setAdding(false)}
          onAdded={(agreement) => {
            onChange([...agreements, agreement]);
            setExpanded(agreement.id);
            setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}

function AgreementRow({ agreement, state, open, onToggle, onEnd, onRestore, onRemove }: {
  agreement: Agreement;
  state: "active" | "historic";
  open: boolean;
  onToggle: () => void;
  onEnd: () => void;
  onRestore: () => void;
  onRemove: () => void;
}) {
  const period = agreement.from || agreement.to
    ? `${agreement.from ? dateLabel(agreement.from) : "—"} – ${agreement.to ? dateLabel(agreement.to) : "løbende"}`
    : "Ingen gyldighed angivet";
  const meta = [agreement.carrier, period, `${agreement.rows.length} ${agreement.rows.length === 1 ? "pris" : "priser"}`, agreement.sample ? "Prøvedata" : ""].filter(Boolean).join(" · ");
  return (
    <li className="agreement-item">
      <button type="button" className="agreement-row" aria-expanded={open} onClick={onToggle}>
        <span className={`state-dot ${state}`} aria-label={state === "active" ? "Aktiv" : "Historisk"} />
        <span className="agreement-name"><strong>{agreement.sample ? agreement.carrier || agreement.name : agreement.name}</strong><small>{meta}</small></span>
        <ChevronDown size={16} className={open ? "rotate" : undefined} />
      </button>
      {open ? (
        <div className="agreement-detail">
          <RateTable rows={agreement.rows} />
          {agreement.sample ? null : (
            <div className="agreement-actions">
              {agreement.ended ? (
                <button type="button" className="text-button" onClick={onRestore}>Gør aktiv igen</button>
              ) : state === "active" ? (
                <button type="button" className="text-button" onClick={onEnd}>Afslut aftale</button>
              ) : null}
              <button type="button" className="text-button muted" onClick={onRemove}>Slet</button>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function RateTable({ rows }: { rows: RateRow[] }) {
  return (
    <div className="rate-scroll">
      <table className="rate-table">
        <thead>
          <tr>
            <th>Leveringsform</th>
            <th>Maks. kg</th>
            <th>Grundpris</th>
            <th>Brændstof</th>
            <th>Fast tillæg</th>
            <th>Gyldig</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.service}-${row.maxWeight}-${index}`}>
              <td>{row.service}</td>
              <td>{row.maxWeight.toLocaleString("da-DK")}</td>
              <td>{money(row.baseOre)}</td>
              <td>{row.fuelPct.toLocaleString("da-DK")} %</td>
              <td>{money(row.fixedOre)}</td>
              <td>{row.from ? dateLabel(row.from) : "—"}{row.to ? ` – ${dateLabel(row.to)}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddAgreementModal({ org, onClose, onAdded }: { org: Org; onClose: () => void; onAdded: (agreement: Agreement) => void }) {
  const [name, setName] = useState("");
  const [carrier, setCarrier] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function pick(chosen: File) {
    setProblem("");
    if (!/\.(csv|tsv|txt)$/i.test(chosen.name)) {
      setProblem("Vælg en CSV- eller TSV-fil. Hent skabelonen, hvis aftalen kun findes som PDF.");
      return;
    }
    if (chosen.size > 1024 * 1024) {
      setProblem("Filen må fylde højst 1 MB.");
      return;
    }
    setFile({ name: chosen.name, csv: decodeCsv(await chosen.arrayBuffer()) });
    if (!name.trim()) setName(chosen.name.replace(/\.[^.]+$/, "").slice(0, 100));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setProblem("Vælg prisaftalens fil.");
      return;
    }
    try {
      onAdded(agreementFromCsv(file.csv, { orgId: org.id, name, carrier, from, to }));
    } catch (error) {
      setProblem((error as Error).message);
    }
  }

  return (
    <Modal title="Tilføj prisaftale" onClose={onClose}>
      <p>Prisaftalen gemmes i denne browser for {org.name} og kan vælges i Nyt fakturatjek. Én række pr. leveringsform og vægttrin.</p>
      <form onSubmit={submit}>
        <div className="file-pick">
          <input
            ref={input}
            className="sr-only"
            type="file"
            tabIndex={-1}
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            aria-label="Vælg prisaftalefil"
            onChange={(event) => {
              const chosen = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (chosen) void pick(chosen);
            }}
          />
          <button type="button" className="button secondary" onClick={() => input.current?.click()}><UploadCloud size={16} /> {file ? "Skift fil" : "Vælg fil"}</button>
          <span>{file ? file.name : "CSV eller TSV · maks. 1 MB"}</span>
          <button type="button" className="text-button muted" onClick={() => downloadCsv("prisaftale-skabelon.csv", DEMO_RATES)}>Hent skabelon</button>
        </div>
        <label>Navn<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="F.eks. GLS 2027" /></label>
        <label>Transportør<input value={carrier} onChange={(event) => setCarrier(event.target.value)} maxLength={70} list="agreement-carriers" placeholder="Transportørens navn" /></label>
        <datalist id="agreement-carriers">{carrierProfiles.map((profile) => <option key={profile.name} value={profile.name} />)}</datalist>
        <div className="date-pair">
          <label>Gyldig fra<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Gyldig til<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        <p className="quiet">Tomme datoer hentes fra filens kolonner gyldig_fra og gyldig_til.</p>
        {problem ? <p className="org-note" role="alert">{problem}</p> : null}
        <button className="button primary" type="submit" disabled={!file}>Gem prisaftale</button>
      </form>
    </Modal>
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
