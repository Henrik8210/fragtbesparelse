import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Sparkles } from "lucide-react";
import { fetchInvoiceCheck } from "./checkClient.ts";
import { extractMailFile } from "./extractClient.ts";
import { checkedExtract, lineChanges, type InvoiceCheck } from "./invoiceCheck.ts";
import { CONFIDENCE_LABELS, lineTotalOre, type InvoiceExtract } from "./invoiceExtract.ts";

const dkk = new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" });
const money = (ore: number) => dkk.format(ore / 100);
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Copenhagen" })
    .format(new Date(`${value}T12:00:00Z`));

const KIND_LABELS = { shipment: "", credit: "Kreditering", surcharge: "Tillæg", fee: "Gebyr" } as const;
const AGAINST_LABELS = { subtotal: "Subtotal ekskl. moms", "total-vat": "I alt minus moms", total: "Faktura i alt", none: "" } as const;

export function CheckedNote({ check }: { check: InvoiceCheck }) {
  const when = new Intl.DateTimeFormat("da-DK", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen",
  }).format(new Date(check.checkedAt));
  const edited = lineChanges(check.original, check.lines).length;
  return (
    <p className="checked-note">
      <CircleCheck size={14} /> Kontrolleret af {check.checkedByName}, {when}.
      {edited ? ` ${edited} ${edited === 1 ? "felt er rettet" : "felter er rettet"}, og de rettede værdier bruges i fakturatjek. Originalen er gemt.` : " Linjerne er godkendt som læst."}
    </p>
  );
}

export function ExtractPanel({ fileId, companyId, checked = "" }: { fileId: string; companyId: string; checked?: string }) {
  const [state, setState] = useState<{ key: string; extract?: InvoiceExtract; check?: InvoiceCheck | null; error?: string } | null>(null);
  const key = `${companyId}\n${fileId}\n${checked}`;
  useEffect(() => {
    let gone = false;
    Promise.all([extractMailFile(fileId, companyId), checked ? fetchInvoiceCheck(fileId, companyId).catch(() => null) : null]).then(
      ([extract, check]) => { if (!gone) setState({ key, extract, check }); },
      (error: unknown) => { if (!gone) setState({ key, error: (error as Error).message }); },
    );
    return () => { gone = true; };
  }, [fileId, companyId, checked, key]);

  const current = state?.key === key ? state : null;
  if (!current) {
    return (
      <section className="extract-panel" aria-busy="true">
        <p className="extract-status"><Sparkles size={15} /> Læser fakturalinjer med Workers AI…</p>
      </section>
    );
  }
  if (current.error || !current.extract) {
    return (
      <section className="extract-panel">
        <p className="extract-status error" role="alert"><CircleAlert size={15} /> {current.error}</p>
      </section>
    );
  }
  if (current.check) {
    return (
      <>
        <CheckedNote check={current.check} />
        <ExtractTable extract={checkedExtract(current.extract, current.check.lines)} />
      </>
    );
  }
  return <ExtractTable extract={current.extract} />;
}

export function ExtractTable({ extract }: { extract: InvoiceExtract }) {
  const { check } = extract;
  const meta = [
    extract.carrier,
    extract.invoiceNumber ? `Faktura ${extract.invoiceNumber}` : "",
    extract.invoiceDate ? dateLabel(extract.invoiceDate) : "",
  ].filter(Boolean).join(" · ");
  return (
    <section className="extract-panel" aria-label="Fakturalinjer læst fra PDF">
      <div className="extract-head">
        <div>
          <h3><Sparkles size={15} /> Fakturalinjer</h3>
          {meta ? <p>{meta}</p> : null}
        </div>
        <span className={`confidence ${extract.confidence}`}>{CONFIDENCE_LABELS[extract.confidence]}</span>
      </div>
      <div className="rate-scroll">
        <table className="rate-table extract-table">
          <thead>
            <tr><th>Forsendelse</th><th>Dato</th><th>Service</th><th>Vægt / rute</th><th className="num">Beløb</th><th>Tillæg</th><th className="num">Linje i alt</th></tr>
          </thead>
          <tbody>
            {extract.lines.map((line, index) => {
              const invoiceLevel = line.kind === "surcharge" || line.kind === "fee";
              const surcharges = invoiceLevel
                ? [{ label: line.service || KIND_LABELS[line.kind], amountOre: line.amountOre }, ...line.surcharges]
                : line.surcharges;
              return (
                <tr key={index} className={line.issues.length ? "flagged" : undefined} title={line.issues.join(" ") || undefined}>
                  <td>
                    {line.shipment || line.reference || `Linje ${index + 1}`}
                    {line.shipment && line.reference ? <small>{line.reference}</small> : null}
                    {invoiceLevel
                      ? <small>{line.kind === "fee" ? "Gebyr på hele fakturaen" : "Tillæg på hele fakturaen"}</small>
                      : KIND_LABELS[line.kind] ? <small>{KIND_LABELS[line.kind]}</small> : null}
                  </td>
                  <td>
                    {line.date ? dateLabel(line.date) : extract.invoiceDate ? dateLabel(extract.invoiceDate) : "—"}
                    {!line.date && extract.invoiceDate ? <small>Fakturadato</small> : null}
                  </td>
                  <td>
                    {invoiceLevel ? "—" : line.service || <span className="soft-hint" title="Fakturaen angiver ikke leveringsform for linjen.">Ikke angivet</span>}
                  </td>
                  <td>{[line.weightKg ? `${line.weightKg.toLocaleString("da-DK")} kg` : "", line.zone].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="num">{invoiceLevel ? "—" : money(line.amountOre)}</td>
                  <td>{surcharges.length ? surcharges.map((item) => `${item.label} ${money(item.amountOre)}`).join(", ") : "—"}</td>
                  <td className="num">
                    {money(lineTotalOre(line))}
                    {line.issues.length ? <small className="flag"><CircleAlert size={12} /> {line.issues[0]}</small> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>Linjesum</td>
              <td className="num">{money(check.lineSumOre)}</td>
            </tr>
            {check.targetOre !== null ? (
              <tr>
                <td colSpan={6}>{AGAINST_LABELS[check.against]}</td>
                <td className="num">{money(check.targetOre)}</td>
              </tr>
            ) : null}
          </tfoot>
        </table>
      </div>
      <p className={`extract-check ${check.status}`}>
        {check.status === "match"
          ? "Linjerne summer til fakturaens total."
          : check.status === "mismatch"
            ? `Linjerne afviger ${money(Math.abs(check.differenceOre ?? 0))} fra fakturaens total.`
            : "Fakturaen har ingen total at afstemme mod."}
      </p>
      {extract.issues.filter((issue) => !/summer ikke|ingen total/.test(issue)).map((issue) => (
        <p key={issue} className="extract-issue"><CircleAlert size={13} /> {issue}</p>
      ))}
      <p className="extract-note">Læst af Workers AI fra PDF'ens tekst. Kontrollér linjerne mod fakturaen.{extract.vatStated ? " Beløb er ekskl. moms." : ""}</p>
    </section>
  );
}
