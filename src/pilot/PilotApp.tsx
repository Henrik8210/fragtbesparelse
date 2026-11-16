import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight, ArrowUpRight, BarChart3, ChevronDown, ChevronRight, ClipboardCheck, Database, FileCheck2,
  FileText, History, LayoutGrid, LockKeyhole, Mail, Package, Plus, RefreshCw, Settings,
} from "lucide-react";
import { ApiError, api } from "../api.ts";
import { carrierProfiles } from "../data/carriers.ts";
import { AuditFlow } from "./audit.tsx";
import {
  BENCHMARK_SERVICES, WEIGHT_BANDS, serviceKey,
  type AuditIndexEntry, type AuditInput, type AuditReport, type Contribution,
} from "./freight.ts";
import { carrierPeers, loadOrgId, orgAudit, orgFromCompany, orgRateRows, ORGS, peerCount, saveOrgId, type Org } from "./orgs.ts";
import { invoiceCsv, invoicesFromReport, rateCsv, ratesFromReport, type PastSource } from "./past.ts";
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

function rateChoices(org: Org, checks: StoredAudit[]): PastSource[] {
  const page = orgRateRows(org);
  const agreement: PastSource[] = page.length ? [{
    id: `agreement:${org.id}`,
    name: org.carrier || "Prisaftale",
    date: page[0]?.from || "",
    carrier: org.carrier,
    note: "Prisaftale",
    csv: org.rates,
  }] : [];
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
  const pastRates = useMemo(() => rateChoices(org, checks), [org, checks]);
  const inCheck = view === "check" || view === "report" || view === "inbox" || view === "agreements";
  const activeTab = inCheck ? "check" : view;
  const activeLabel = view === "report" ? "Rapport"
    : view === "inbox" ? "Modtaget"
    : view === "agreements" ? "Prisaftaler"
    : NAV.find((tab) => tab.id === activeTab)?.label;
  const peers = peerCount(org.id);

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
            <Fragment key={id}>
              <button
                type="button"
                className={view === id || (id === "check" && view === "report") ? "nav-item active" : activeTab === id ? "nav-item section" : "nav-item"}
                aria-current={view === id || (id === "check" && view === "report") ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={19} /><span>{label}</span>
              </button>
              {id === "check" ? (
                <div className="nav-sub">
                  <button type="button" className={view === "inbox" ? "active" : ""} aria-current={view === "inbox" ? "page" : undefined} onClick={() => navigate("inbox")}>
                    <Mail size={15} /><span>Modtaget</span>
                  </button>
                  <button type="button" className={view === "agreements" ? "active" : ""} aria-current={view === "agreements" ? "page" : undefined} onClick={() => navigate("agreements")}>
                    <FileText size={15} /><span>Prisaftaler</span>
                  </button>
                </div>
              ) : null}
            </Fragment>
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
              onChecks={() => navigate("check")}
              onCoverage={() => navigate("coverage")}
            />
          ) : null}
          {view === "check" ? (
            <ChecksPage checks={checks} onStart={newAudit} onOpen={openReport} />
          ) : null}
          {view === "inbox" ? <InboxView key={org.id} admin={admin} orgId={org.id} orgs={orgs} /> : null}
          {view === "agreements" ? <AgreementsView org={org} /> : null}
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

type MailFile = { id: string; filename: string; bytes: number };
type MailRow = { id: string; sender: string; subject: string; receivedAt: string; files: MailFile[] };

const CARRIER_RULES: { name: string; pattern: RegExp }[] = [
  { name: "PostNord", pattern: /post[\s-]?nord/i },
  { name: "Danske Fragtmænd", pattern: /fragtm[aæ]nd|fragtmaend/i },
  { name: "Schenker", pattern: /schenker/i },
  { name: "GLS", pattern: /\bgls\b/i },
  { name: "DHL", pattern: /\bdhl\b/i },
  { name: "DSV", pattern: /\bdsv\b/i },
  { name: "Bring", pattern: /\bbring\b/i },
  { name: "DAO", pattern: /\bdao\b/i },
  { name: "UPS", pattern: /\bups\b/i },
];

function carrierFromMail(mail: MailRow): string {
  const quoted = mail.sender.match(/<([^>]+)>/)?.[1] ?? mail.sender;
  const address = quoted.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  const domain = at >= 0 ? address.slice(at + 1) : "";
  const files = mail.files.map((file) => file.filename).join(" ");
  const haystack = `${domain} ${mail.subject} ${files}`;
  return CARRIER_RULES.find((rule) => rule.pattern.test(haystack))?.name ?? "";
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
          <p>{loading || !problem ? (ready || loading ? "Mail til adressen lander under Modtaget." : "Adressen kan kopieres. Vedhæftninger gemmes, når indbakken er sat op.") : "Indbakken kunne ikke læses."}</p>
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

function InboxView({ admin, orgId, orgs }: { admin: boolean; orgId: string; orgs: { id: string; name: string }[] }) {
  const key = mailKey(admin, orgId);
  const cached = readMail(key);
  const [mails, setMails] = useState<MailRow[]>(cached?.mails ?? []);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState(cached?.error ?? "");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<{ subject: string; files: MailFile[]; fileId: string } | null>(null);
  const reload = useRef<(manual: boolean) => void>(() => undefined);
  const ownerName = orgs.find((item) => item.id === orgId)?.name ?? "";
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
        setProblem(next.error);
      } catch {
        if (gone || cacheEpoch() !== epoch || readMail(key)) return;
        setProblem("Kunne ikke hente indbakken.");
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

  async function downloadOpen() {
    if (!openFile) return;
    const response = await fetch(
      `/api/invoice-mail/files/${encodeURIComponent(openFile.id)}?company=${encodeURIComponent(orgId)}`,
      { credentials: "same-origin" },
    );
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = openFile.filename.split(/[/\\]/).pop() || "faktura.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="content-flow">
      <div className="page-intro">
        <span className="eyebrow"><i /> FAKTURAMAIL</span>
        <h1>Modtaget</h1>
        <p>Fakturaer sendt til {ownerName || "organisationen"}. Listen opdateres af sig selv, mens siden er åben.</p>
      </div>
      <section className="panel" aria-busy={loading}>
        <div className="section-heading"><h2>Indbakke</h2><p>{loading ? "Henter" : `${shown.length} mails`}</p></div>
        <div className="mail-tools">
          <label>
            Transportør
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtrér på transportør">
              <option value="">Alle</option>
              {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
              {unknown ? <option value="ukendt">Ukendt</option> : null}
            </select>
          </label>
          <button className="button secondary" type="button" onClick={() => reload.current(true)} disabled={refreshing}>
            <RefreshCw size={16} /> {refreshing ? "Opdaterer" : "Opdater"}
          </button>
        </div>
        {loading ? <MailSkeleton /> : problem ? <p className="org-note" style={{ padding: "0 18px 16px" }}>{problem}</p> : shown.length === 0 ? (
          <p className="quiet" style={{ padding: "0 18px 16px" }}>{mails.length === 0 ? "Ingen fakturamail endnu." : "Ingen mails for den transportør."}</p>
        ) : (
          <>
            <div className="mail-head"><span>Emne</span><span>Transportør</span><span className="mail-file">Fil</span></div>
            <ul className="mail-list">
              {shown.map((mail) => {
                const pdfs = mail.files.filter((file) => file.filename.toLowerCase().endsWith(".pdf"));
                const carrier = carrierFromMail(mail);
                return (
                  <li key={mail.id}>
                    <button
                      type="button"
                      className="mail-row"
                      onClick={() => setOpen({ subject: mail.subject, files: pdfs, fileId: pdfs[0]?.id ?? "" })}
                    >
                      <span>
                        <strong>{mail.subject}</strong>
                        <small>{mail.sender} · {dateLabel(mail.receivedAt)}</small>
                      </span>
                      <span className="mail-carrier">{carrier || "—"}</span>
                      <span className="mail-file">{pdfs[0]?.filename ?? "Ingen PDF"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      {open ? (
        <Modal title={open.subject} wide onClose={() => setOpen(null)}>
          {open.files.length > 1 ? (
            <div className="invoice-files">
              {open.files.map((file) => (
                <button key={file.id} type="button" className={file.id === open.fileId ? "active" : ""} onClick={() => setOpen({ ...open, fileId: file.id })}>{file.filename}</button>
              ))}
            </div>
          ) : null}
          {open.fileId ? (
            <>
              <div className="invoice-toolbar">
                <button className="button secondary" type="button" onClick={() => void downloadOpen()} disabled={!openFile}>Hent</button>
              </div>
              <InvoicePages fileId={open.fileId} companyId={orgId} />
            </>
          ) : <p>Denne mail har ingen PDF.</p>}
        </Modal>
      ) : null}
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
      const response = await fetch(
        `/api/invoice-mail/files/${encodeURIComponent(fileId)}?company=${encodeURIComponent(companyId)}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        if (!gone) setState("missing");
        return;
      }
      const data = new Uint8Array(await response.arrayBuffer());
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

function AgreementsView({ org }: { org: Org }) {
  const rows = useMemo(() => orgRateRows(org), [org]);
  return (
    <div className="content-flow">
      <div className="page-intro">
        <span className="eyebrow"><i /> PRISAFTALER</span>
        <h1>Prisaftaler</h1>
        <p>Aftaler for {org.name}. De seks prøvefirmaer har en prøveaftale. En ny organisation starter uden.</p>
      </div>
      {rows.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <div className="empty-icon"><FileText size={24} /></div>
            <strong>Ingen prisaftaler endnu</strong>
            <p>Når en prisaftale er lagt ind for {org.name}, vises den her.</p>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="section-heading">
            <h2>{org.carrier || "Prisaftale"}</h2>
            <p>Prøveaftale · oktober 2026</p>
          </div>
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
        </section>
      )}
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
