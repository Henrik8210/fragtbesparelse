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
import { ExtractTable } from "./ExtractPanel.tsx";
import { extractMailFile, extractUpload } from "./extractClient.ts";
import { MAX_FILE_BYTES, runAudit, type AuditInput, type AuditReport } from "./freight.ts";
import { CONFIDENCE_LABELS, extractToInvoiceRows, sharedSurchargeOre, type InvoiceExtract } from "./invoiceExtract.ts";
import { fetchInvoiceCheck } from "./checkClient.ts";
import { checkedExtract, rowsFromLines, type InvoiceCheck } from "./invoiceCheck.ts";
import { invoiceCsv, type PastSource } from "./past.ts";

type Uploaded = { name: string; sheet: CsvSheet; mapping: Mapping; extract?: InvoiceExtract; checked?: InvoiceCheck };

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
          <p className="quiet"><ShieldCheck size={17} /> CSV læses i browseren. En PDF læses af Workers AI hos Freightlytics. Du vælger, om resultatet skal gemmes.</p>
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

function extractSheet(extract: InvoiceExtract): CsvSheet {
  return parseCsv(invoiceCsv(extractToInvoiceRows(extract)));
}

/** A checked invoice is used with its checked lines. An unchecked one is used as read. */
async function mailSource(fileId: string, filename: string, companyId: string): Promise<{ csv: string; checked?: InvoiceCheck } | { extract: InvoiceExtract; checked?: InvoiceCheck }> {
  const check = await fetchInvoiceCheck(fileId, companyId).catch(() => null);
  if (/\.pdf$/i.test(filename)) {
    const extract = await extractMailFile(fileId, companyId);
    return check ? { extract: checkedExtract(extract, check.lines), checked: check } : { extract };
  }
  if (check) return { csv: invoiceCsv(rowsFromLines(check.lines)), checked: check };
  const response = await fetch(
    `/api/invoice-mail/files/${encodeURIComponent(fileId)}?company=${encodeURIComponent(companyId)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) throw new Error("Filen kunne ikke hentes.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("Filen må fylde højst 1 MB.");
  const head = String.fromCharCode(...new Uint8Array(bytes.slice(0, 5)));
  if (head === "%PDF-") return { extract: await extractMailFile(fileId, companyId) };
  return { csv: decodeCsv(bytes) };
}

function ExtractSummary({ extract, checked }: { extract: InvoiceExtract; checked?: InvoiceCheck }) {
  const [open, setOpen] = useState(false);
  const shared = sharedSurchargeOre(extract);
  const kr = (ore: number) => (ore / 100).toLocaleString("da-DK", { style: "currency", currency: "DKK" });
  return (
    <div className="extract-summary">
      <p>
        <span className={`confidence ${extract.confidence}`}>{CONFIDENCE_LABELS[extract.confidence]}</span>
        {" "}{checked ? `Læst fra PDF med Workers AI og kontrolleret af ${checked.checkedByName}. De kontrollerede værdier bruges.` : "Læst fra PDF med Workers AI."}{" "}
        {extract.check.status === "match" ? "Linjerne summer til fakturaens total." : extract.check.status === "mismatch" ? `Linjerne afviger ${kr(Math.abs(extract.check.differenceOre ?? 0))} fra totalen.` : "Ingen total at afstemme mod."}
        {shared ? ` Tillæg på fakturaniveau (${kr(shared)}) er fordelt på forsendelserne efter beløb.` : ""}
      </p>
      <button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Skjul linjer" : "Vis linjer"} <ChevronDown size={15} className={open ? "rotate" : ""} />
      </button>
      {open ? <ExtractTable extract={extract} /> : null}
    </div>
  );
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
      const loaded = source.csv !== undefined ? { csv: source.csv } : await mailSource(source.fileId ?? "", source.note, companyId);
      if (id !== uploadId.current) return;
      const extract = "extract" in loaded ? loaded.extract : undefined;
      const checked = "checked" in loaded ? loaded.checked : undefined;
      const sheet = "extract" in loaded ? extractSheet(loaded.extract) : parseCsv(loaded.csv);
      if (!sheet.rows.length) throw new Error("Filen har ingen datalinjer.");
      const mapping = suggestMapping(kind, sheet.headers);
      onChange({ name: source.name, sheet, mapping, extract, checked });
      setPicked(source.id);
      setShowMapping(Boolean(missingFields(kind, mapping).length));
      onHint?.(extract?.carrier && !source.carrier ? { ...source, carrier: extract.carrier } : source);
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
      if (invoice && /\.pdf$/i.test(file.name)) {
        if (!companyId) throw new Error("Vælg en organisation, før en PDF kan læses.");
        if (file.size > 8_000_000) throw new Error("PDF'en må fylde højst 8 MB.");
        setBusy("upload");
        const extract = await extractUpload(file, companyId);
        if (id !== uploadId.current) return;
        const sheet = extractSheet(extract);
        const mapping = suggestMapping(kind, sheet.headers);
        onChange({ name: file.name, sheet, mapping, extract });
        setPicked("");
        setShowMapping(false);
        if (extract.carrier) onHint?.({ id: "upload", name: file.name, date: "", carrier: extract.carrier, note: "" });
        return;
      }
      if (!/\.(csv|tsv)$/i.test(file.name)) throw new Error(invoice ? "Vælg en CSV-, TSV- eller PDF-fil." : "Vælg en CSV- eller TSV-fil.");
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
    } finally {
      if (id === uploadId.current) setBusy((now) => (now === "upload" ? "" : now));
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
          accept={invoice ? ".csv,.tsv,.pdf,text/csv,text/tab-separated-values,application/pdf" : ".csv,.tsv,text/csv,text/tab-separated-values"}
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
            <span>{value.sheet.rows.length.toLocaleString("da-DK")} {value.extract ? "forsendelser fra PDF" : "datalinjer"}</span>
            <div className="drop-links">
              <button type="button" className="text-button" onClick={() => input.current?.click()}>Skift fil</button>
              <button type="button" className="icon-button" aria-label="Fjern fil" onClick={clear}><X size={15} /></button>
            </div>
          </>
        ) : busy === "upload" ? (
          <>
            <div className="drop-icon"><UploadCloud size={23} /></div>
            <span role="status">Læser PDF'ens linjer med Workers AI…</span>
          </>
        ) : (
          <>
            <div className="drop-icon"><UploadCloud size={23} /></div>
            <button type="button" className="text-button" onClick={() => input.current?.click()}>Vælg fil</button>
            <span>eller slip den her · {invoice ? "CSV / TSV maks. 1 MB · PDF maks. 8 MB" : "CSV / TSV · maks. 1 MB"}</span>
          </>
        )}
      </div>
      ) : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {value?.extract ? <ExtractSummary extract={value.extract} checked={value.checked} /> : null}
      {value?.checked && !value.extract ? <p className="extract-summary">Kontrolleret af {value.checked.checkedByName}. De kontrollerede værdier bruges.</p> : null}
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
