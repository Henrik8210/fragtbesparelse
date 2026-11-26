import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { matchInvoice } from "./agreementDating.ts";
import { AgreementMatch } from "./AgreementMatch.tsx";
import type { Agreement } from "./agreements.ts";
import { fetchInvoiceCheck } from "./checkClient.ts";
import { loadCheckSource } from "./checkSource.ts";
import { useAgreementChoice } from "./useAgreementChoice.ts";
import { rowsFromLines } from "./invoiceCheck.ts";

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
  const [read, setRead] = useState<{ key: string; dates?: { date: string }[]; invoiceDate?: string; carrier?: string; error?: string } | null>(null);
  const key = `${companyId}\n${fileId}\n${checked}`;
  const { choice, choose, saving, problem } = useAgreementChoice(companyId, fileId);
  useEffect(() => {
    let gone = false;
    Promise.all([loadCheckSource(fileId, filename, companyId), checked ? fetchInvoiceCheck(fileId, companyId).catch(() => null) : null])
      .then(([source, check]) => {
        const lines = check?.lines ?? source.lines;
        const invoiceDate = source.extract?.invoiceDate ?? "";
        let dates: { date: string }[];
        try {
          dates = rowsFromLines(lines, { invoiceNumber: source.extract?.invoiceNumber, invoiceDate });
        } catch {
          dates = lines.filter((line) => line.kind === "shipment" || line.kind === "credit");
        }
        if (!dates.length && invoiceDate) dates = [{ date: invoiceDate }];
        if (!gone) setRead({ key, dates, invoiceDate, carrier: source.extract?.carrier ?? "" });
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
  if (!current) return <p className="extract-status"><CalendarClock size={15} /> Finder prisaftalen for fakturaens datoer…</p>;
  if (!match) return null;
  return (
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
  );
}
