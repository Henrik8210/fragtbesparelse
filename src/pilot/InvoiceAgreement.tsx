import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { datedAudit, matchInvoice } from "./agreementDating.ts";
import { hasTerms } from "./agreementFormat.ts";
import { AgreementMatch } from "./AgreementMatch.tsx";
import type { Agreement } from "./agreements.ts";
import { fetchInvoiceCheck } from "./checkClient.ts";
import { loadCheckSource } from "./checkSource.ts";
import { useAgreementChoice } from "./useAgreementChoice.ts";
import { checkedExtract, rowsFromLines } from "./invoiceCheck.ts";
import { linesFromExtractForAudit, type TermsLine } from "./termsAudit.ts";
import { money } from "./report.tsx";

/** In the invoice viewer: which agreement the file's lines match, read the same way as Check faktura. */
export function InvoiceAgreement({ fileId, filename, companyId, carrier, checked, agreements, onAdd }: {
  fileId: string;
  filename: string;
  companyId: string;
  carrier: string;
  checked: string;
  agreements: Agreement[];
  onAdd: (carrier: string) => void;
}) {
  const [read, setRead] = useState<{ key: string; dates?: { date: string }[]; priced?: TermsLine[]; invoiceDate?: string; carrier?: string; error?: string } | null>(null);
  const key = `${companyId}\n${fileId}\n${checked}`;
  const { choice, choose, saving, problem } = useAgreementChoice(companyId, fileId);
  useEffect(() => {
    let gone = false;
    Promise.all([loadCheckSource(fileId, filename, companyId), checked ? fetchInvoiceCheck(fileId, companyId).catch(() => null) : null])
      .then(([source, check]) => {
        const lines = check?.lines ?? source.lines;
        const invoiceDate = source.extract?.invoiceDate ?? "";
        const priced = source.extract ? linesFromExtractForAudit(check ? checkedExtract(source.extract, check.lines) : source.extract) : undefined;
        let dates: { date: string }[];
        try {
          dates = priced ?? rowsFromLines(lines, { invoiceNumber: source.extract?.invoiceNumber, invoiceDate });
        } catch {
          dates = lines.filter((line) => line.kind === "shipment" || line.kind === "credit");
        }
        if (!dates.length && invoiceDate) dates = [{ date: invoiceDate }];
        if (!gone) setRead({ key, dates, priced, invoiceDate, carrier: source.extract?.carrier ?? "" });
      })
      .catch((error: unknown) => { if (!gone) setRead({ key, error: (error as Error).message }); });
    return () => { gone = true; };
  }, [fileId, filename, companyId, checked, key]);

  const current = read?.key === key ? read : null;
  const who = carrier || current?.carrier || "";
  const match = useMemo(
    () => current?.dates ? matchInvoice(current.dates, { invoiceDate: current.invoiceDate, carrier: who, agreements, override: choice?.agreementId }) : null,
    [current, who, agreements, choice],
  );
  const compared = useMemo(() => {
    if (!match || match.held || !current?.priced) return null;
    const used = new Set(match.used.map((item) => item.agreementId));
    if (!agreements.some((item) => used.has(item.id) && hasTerms(item.terms))) return null;
    try {
      return datedAudit(current.priced, match, agreements);
    } catch {
      return null;
    }
  }, [match, current, agreements]);
  if (!current) return <p className="extract-status"><CalendarClock size={15} /> Finder prisaftalen for fakturaens datoer…</p>;
  if (!match) return null;
  const deviations = compared?.lines.filter((line) => line.status === "over" || line.status === "under") ?? [];
  return (
    <>
      <AgreementMatch
        match={match}
        agreements={agreements}
        carrier={who}
        choice={choice}
        saving={saving}
        problem={problem}
        onChoose={(id) => void choose(id)}
        onAdd={onAdd}
      />
      {compared ? (
        <section className="extract-panel" aria-label="Afvigelser fra prisaftalen">
          <div className="extract-head">
            <div>
              <h3>Afvigelser fra prisaftalen</h3>
              <p>
                {compared.summary.overOre > 0 ? <>Over aftalen <strong>{money(compared.summary.overOre)}</strong> ekskl. moms. </> : null}
                {compared.summary.underOre > 0 ? <>Under aftalen <strong>{money(compared.summary.underOre)}</strong>. </> : null}
                {compared.summary.match.toLocaleString("da-DK")} {compared.summary.match === 1 ? "linje stemmer" : "linjer stemmer"}.
              </p>
            </div>
          </div>
          {deviations.length ? (
            <div className="rate-scroll">
              <table className="rate-table">
                <thead><tr><th>Linje</th><th className="num">Faktureret</th><th className="num">Aftalt</th><th className="num">Forskel</th></tr></thead>
                <tbody>
                  {deviations.map((line) => (
                    <tr key={line.key}>
                      <td>{line.service}<small className="quiet">{line.reason}</small></td>
                      <td className="num">{money(line.billedOre)}</td>
                      <td className="num">{line.expectedOre === null ? "—" : money(line.expectedOre)}</td>
                      <td className={`num${line.status === "over" ? " text-alert" : ""}`}>{line.differenceOre === null ? "—" : `${line.differenceOre > 0 ? "+" : ""}${money(line.differenceOre)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="quiet">Alle sammenlignede linjer stemmer med prisaftalen.</p>}
        </section>
      ) : null}
    </>
  );
}
