import { useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleHelp, ClipboardList,
  FileSpreadsheet, FileText, ShieldCheck, UploadCloud, X,
} from "lucide-react";
import {
  decodeCsv, IMPORT_FIELDS, importRows, missingFields, parseCsv, suggestMapping,
  type CsvSheet, type ImportKind, type Mapping,
} from "./csv.ts";
import { DEMO_INVOICE, DEMO_RATES } from "./demo.ts";
import { MAX_FILE_BYTES, runAudit, type AuditInput, type AuditReport } from "./freight.ts";
import type { PastSource } from "./past.ts";

type Uploaded = { name: string; sheet: CsvSheet; mapping: Mapping };

export type { PastSource };

export function downloadCsv(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", contents], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AuditFlow({
  onReport, onExample, embedded = false, companyId = "", invoices = [], rates: pastRates = [],
}: {
  onReport: (input: AuditInput, report: AuditReport) => void;
  onExample: () => void;
  embedded?: boolean;
  companyId?: string;
  invoices?: PastSource[];
  rates?: PastSource[];
}) {
  const [invoice, setInvoice] = useState<Uploaded | null>(null);
  const [rates, setRates] = useState<Uploaded | null>(null);
  const [name, setName] = useState("");
  const [carrier, setCarrier] = useState("");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!invoice || !rates) return;
    try {
      const parse = <T,>(label: string, action: () => T): T => {
        try { return action(); }
        catch (cause) { throw new Error(`${label}. ${(cause as Error).message}`); }
      };
      const invoiceRows = parse("Fragtfaktura", () => importRows("invoice", invoice.sheet, invoice.mapping));
      const rateRows = parse("Prisaftale", () => importRows("rates", rates.sheet, rates.mapping));
      const input: AuditInput = {
        name: name.trim() || invoice.name.replace(/\.[^.]+$/, "").slice(0, 100) || "Fakturatjek",
        carrier: carrier.trim(),
        invoice: invoiceRows,
        rates: rateRows,
        contribution: null,
      };
      setError("");
      onReport(input, runAudit(invoiceRows, rateRows));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <div className="content-flow">
      {embedded ? null : (
        <>
          <div className="page-intro split">
            <div>
              <span className="eyebrow"><i /> FAKTURAKONTROL</span>
              <h1>Nyt fakturatjek</h1>
              <p>Indlæs et udtræk af fakturaen og den prisaftale, der gjaldt for forsendelserne.</p>
            </div>
            <button type="button" className="button secondary" onClick={onExample}><FileText size={17} /> Prøv med eksempel</button>
          </div>
          <div className="step-strip" aria-label="Trin i fakturakontrol">
            <div className="step current"><span>01</span><div><strong>Indlæs filer</strong><small>Faktura og prisaftale</small></div></div>
            <ChevronDown className="step-arrow" size={16} />
            <div className="step"><span>02</span><div><strong>Kontrollér</strong><small>Sammenlign priser</small></div></div>
            <ChevronDown className="step-arrow" size={16} />
            <div className="step"><span>03</span><div><strong>Gennemgå</strong><small>Se afvigelser</small></div></div>
          </div>
        </>
      )}

      <form onSubmit={submit}>
        <div className="upload-grid">
          <UploadCard
            kind="invoice"
            value={invoice}
            past={invoices}
            companyId={companyId}
            onChange={(file) => { setInvoice(file); setError(""); }}
            onHint={(source) => {
              if (!name.trim() && source.name) setName(source.name.replace(/\.[^.]+$/, "").slice(0, 100));
              if (!carrier.trim() && source.carrier) setCarrier(source.carrier.slice(0, 70));
            }}
          />
          <UploadCard kind="rates" value={rates} past={pastRates} companyId={companyId} onChange={(file) => { setRates(file); setError(""); }} />
        </div>

        <div className="panel report-info">
          <div className="icon-box"><ClipboardList size={19} /></div>
          <div className="report-info-body">
            <h2>Om rapporten</h2>
            <div className="input-grid">
              <label>Rapportnavn <span>valgfrit</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="F.eks. Oktober 2026" /></label>
              <label>Transportør <span>valgfrit</span><input value={carrier} onChange={(event) => setCarrier(event.target.value)} maxLength={70} placeholder="Transportørens navn" /></label>
            </div>
          </div>
        </div>

        {error ? <div className="message error" role="alert">{error}</div> : null}
        <div className="form-actions">
          <p className="quiet"><ShieldCheck size={17} /> Filerne læses i browseren. Du vælger, om resultatet skal gemmes.</p>
          <div className="actions">
            {embedded ? <button type="button" className="button secondary" onClick={onExample}><FileText size={17} /> Prøv med eksempel</button> : null}
            <button type="submit" className="button primary" disabled={!invoice || !rates}>
              Beregn afvigelser <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </form>

      <details className="help-box">
        <summary><CircleHelp size={17} /> Hvilke oplysninger skal jeg bruge?</summary>
        <div>
          <p>Brug én række pr. forsendelse. Angiv forsendelsesnummer, dato, leveringsform, faktureret vægt og samlet fakturabeløb i DKK ekskl. moms. Lande kan angives med to bogstaver. Tomme landefelter behandles som Danmark.</p>
          <p>Brug samme leveringsformer i prisaftalen. For hvert vægttrin angiver du den øvre vægtgrænse og grundprisen. Du kan tilføje brændstoftillæg i procent, fast tillæg i kroner og gyldighedsdatoer.</p>
        </div>
      </details>
    </div>
  );
}

function shortDate(value: string) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Copenhagen" }).format(date);
}

async function mailCsv(fileId: string, companyId: string) {
  const response = await fetch(
    `/api/invoice-mail/files/${encodeURIComponent(fileId)}?company=${encodeURIComponent(companyId)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) throw new Error("Filen kunne ikke hentes.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("Filen må fylde højst 1 MB.");
  const head = String.fromCharCode(...new Uint8Array(bytes.slice(0, 5)));
  if (head === "%PDF-") throw new Error("PDF'en har ikke et linjeudtræk. Vælg en CSV eller en tidligere kontrol.");
  return decodeCsv(bytes);
}

function UploadCard({
  kind, value, onChange, past, companyId, onHint,
}: {
  kind: ImportKind;
  value: Uploaded | null;
  onChange: (value: Uploaded | null) => void;
  past: PastSource[];
  companyId: string;
  onHint?: (source: PastSource) => void;
}) {
  const invoice = kind === "invoice";
  const [mode, setMode] = useState<"upload" | "library">("upload");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [error, setError] = useState("");
  const uploadId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const library = past
    .filter((source) => !needle || `${source.name} ${source.carrier} ${source.note} ${shortDate(source.date)}`.toLowerCase().includes(needle))
    .slice()
    .sort((left, right) => (right.date || "").localeCompare(left.date || ""));

  function clear() {
    uploadId.current += 1;
    setPicked("");
    setBusy("");
    onChange(null);
    setError("");
  }

  async function choose(source: PastSource) {
    const id = ++uploadId.current;
    setError("");
    setBusy(source.id);
    try {
      const csv = source.csv ?? await mailCsv(source.fileId ?? "", companyId);
      if (id !== uploadId.current) return;
      const sheet = parseCsv(csv);
      if (!sheet.rows.length) throw new Error("Filen har ingen datalinjer.");
      const mapping = suggestMapping(kind, sheet.headers);
      onChange({ name: source.name, sheet, mapping });
      setPicked(source.id);
      setShowMapping(Boolean(missingFields(kind, mapping).length));
      onHint?.(source);
    } catch (cause) {
      if (id !== uploadId.current) return;
      setPicked("");
      setError((cause as Error).message);
    } finally {
      if (id === uploadId.current) setBusy("");
    }
  }

  async function load(file: File) {
    const id = ++uploadId.current;
    setError("");
    try {
      if (!/\.(csv|tsv)$/i.test(file.name)) throw new Error("Vælg en CSV- eller TSV-fil.");
      if (file.size > MAX_FILE_BYTES) throw new Error("Filen må fylde højst 1 MB.");
      const sheet = parseCsv(decodeCsv(await file.arrayBuffer()));
      if (id !== uploadId.current) return;
      const mapping = suggestMapping(kind, sheet.headers);
      onChange({ name: file.name, sheet, mapping });
      setPicked("");
      setShowMapping(Boolean(missingFields(kind, mapping).length));
    } catch (cause) {
      if (id !== uploadId.current) return;
      setError((cause as Error).message);
    }
  }

  return (
    <section className="panel upload-card">
      <div className="upload-heading">
        <div className="icon-box">{invoice ? <FileText size={21} /> : <FileSpreadsheet size={21} />}</div>
        <div>
          <h2>{invoice ? "Fragtfaktura" : "Prisaftale"}</h2>
          <p>{invoice ? "Én linje pr. forsendelse inklusive tillæg." : "Priser og tillæg pr. service og vægttrin."}</p>
        </div>
      </div>
      <div className="source-switch" role="tablist" aria-label={invoice ? "Fakturaens kilde" : "Prisaftalens kilde"}>
        <button type="button" role="tab" aria-selected={mode === "upload"} onClick={() => setMode("upload")}>Upload</button>
        <button type="button" role="tab" aria-selected={mode === "library"} onClick={() => setMode("library")}>Vælg tidligere</button>
      </div>
      {mode === "library" ? (
        <div className="past-panel">
          <input className="past-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søg navn, dato eller transportør" aria-label="Søg tidligere" />
          {value ? (
            <p className="past-chosen"><Check size={14} /> {value.name} · {value.sheet.rows.length.toLocaleString("da-DK")} linjer <button type="button" onClick={clear}>Fjern</button></p>
          ) : null}
          {library.length === 0 ? (
            <p className="past-empty">{past.length === 0 ? (invoice ? "Ingen tidligere fakturaer." : "Ingen tidligere prisaftaler.") : "Ingen træffere."}</p>
          ) : (
            <ul className="past-list">
              {library.map((source) => (
                <li key={source.id}>
                  <button type="button" className={picked === source.id ? "active" : ""} disabled={busy === source.id} onClick={() => void choose(source)}>
                    <strong>{source.name}</strong>
                    <small>{[shortDate(source.date), source.carrier, source.note].filter(Boolean).join(" · ")}{busy === source.id ? " · Henter" : ""}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {mode === "upload" ? (
      <div
        className={`drop-zone ${dragging ? "dragging" : ""} ${value ? "filled" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void load(file);
        }}
      >
        <input
          ref={input}
          className="sr-only"
          type="file"
          tabIndex={-1}
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          aria-label={invoice ? "Vælg fakturafil" : "Vælg prisaftalefil"}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void load(file);
          }}
        />
        {value ? (
          <>
            <div className="drop-icon"><Check size={22} /></div>
            <strong className="filename">{value.name}</strong>
            <span>{value.sheet.rows.length.toLocaleString("da-DK")} datalinjer</span>
            <div className="drop-links">
              <button type="button" className="text-button" onClick={() => input.current?.click()}>Skift fil</button>
              <button type="button" className="icon-button" aria-label="Fjern fil" onClick={clear}><X size={15} /></button>
            </div>
          </>
        ) : (
          <>
            <div className="drop-icon"><UploadCloud size={23} /></div>
            <button type="button" className="text-button" onClick={() => input.current?.click()}>Vælg fil</button>
            <span>eller slip den her · CSV / TSV · maks. 1 MB</span>
          </>
        )}
      </div>
      ) : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <div className="upload-footer">
        <button
          type="button"
          className="text-button muted"
          onClick={() => downloadCsv(invoice ? "fragtfaktura-skabelon.csv" : "prisaftale-skabelon.csv", invoice ? DEMO_INVOICE : DEMO_RATES)}
        >
          <ArrowDownToLine size={15} /> Hent skabelon
        </button>
        {value ? (
          <button type="button" className="text-button" aria-expanded={showMapping} onClick={() => setShowMapping(!showMapping)}>
            Kolonner <ChevronDown size={15} className={showMapping ? "rotate" : ""} />
          </button>
        ) : null}
      </div>
      {value && showMapping ? (
        <div className="mapping">
          <p>Tilknyt kolonner fra dit udtræk.</p>
          {IMPORT_FIELDS[kind].map((field) => (
            <label key={field.id}>
              <span>{field.label}{field.required ? <b> *</b> : null}</span>
              <select
                value={value.mapping[field.id] ?? -1}
                onChange={(event) => onChange({
                  ...value,
                  mapping: { ...value.mapping, [field.id]: Number(event.target.value) },
                })}
              >
                <option value={-1}>{field.required ? "Vælg kolonne" : "Udeladt"}</option>
                {value.sheet.headers.map((header, index) => <option key={index} value={index}>{header || `Kolonne ${index + 1}`}</option>)}
              </select>
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}
