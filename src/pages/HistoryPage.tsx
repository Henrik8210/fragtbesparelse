import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { formatKr } from "../format.ts";
import { useLanguage } from "../language.tsx";
import { GateView, useCustomerGate } from "./gate.tsx";
import { NotFound } from "./NotFound.tsx";

type ReportLine = { carrier: string; route: string; difference: number };
type Report = {
  id: string;
  name: string;
  createdAt: string;
  summary: { month?: string; lines?: ReportLine[] };
};

export function HistoryPage() {
  const gate = useCustomerGate();
  const { t } = useLanguage();
  if (gate.status === "loading") return null;
  if (gate.status === "missing") return <NotFound title={t("notFound.noCompany")} body={t("notFound.noCompanyBody")} />;
  if (gate.status !== "ok") {
    return (
      <div className="page">
        <GateView gate={gate} />
      </div>
    );
  }
  return <HistoryDetail customerId={gate.customer.id} name={gate.customer.name} />;
}

function HistoryDetail({ customerId, name }: { customerId: string; name: string }) {
  const { t } = useLanguage();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    api<{ reports: Report[] }>(`/api/companies/${customerId}/reports`).then((result) => {
      if (!cancel) {
        setReports(result.reports);
        setOpen(result.reports[0]?.id ?? null);
      }
    });
    return () => {
      cancel = true;
    };
  }, [customerId]);

  const selected = reports?.find((report) => report.id === open) ?? null;

  return (
    <div className="page">
      <h1>{t("history.title")}</h1>
      <p className="meta">{name}</p>
      <p className="section-intro">{t("history.lead")}</p>
      {reports && reports.length === 0 ? <p>{t("history.empty")}</p> : null}
      <ul className="seat-list">
        {(reports ?? []).map((report) => (
          <li key={report.id}>
            <button type="button" className="text-link" onClick={() => setOpen(report.id)}>
              {report.name}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <section className="block">
          <h2>{selected.name}</h2>
          <ul>
            {(selected.summary.lines ?? []).map((line) => (
              <li key={`${line.carrier}-${line.route}`}>
                {t("history.raise", { amount: formatKr(line.difference), carrier: line.carrier })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
