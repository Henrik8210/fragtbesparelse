import { useState } from "react";
import { InvoiceCheck } from "../components/InvoiceCheck.tsx";
import { api } from "../api.ts";
import { LATEST_MONTH, MONTHS, latestFromLanes } from "../data/portfolio.ts";
import { accountAnswers } from "../data/questions.ts";
import { useLanguage } from "../language.tsx";
import { GateView, useCustomerGate } from "./gate.tsx";
import { NotFound } from "./NotFound.tsx";

export function CheckPage() {
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
  return <CheckDetail />;
}

function CheckDetail() {
  const gate = useCustomerGate();
  const { t, phrase } = useLanguage();
  const [saved, setSaved] = useState(false);
  if (gate.status !== "ok") return null;
  const customer = gate.customer;
  const latest = latestFromLanes(customer);
  const answers = accountAnswers(customer);
  const month = phrase(`month.${MONTHS[MONTHS.length - 1].id}`, LATEST_MONTH);

  async function save() {
    await api(`/api/companies/${customer.id}/reports`, {
      method: "POST",
      body: JSON.stringify({
        name: t("check.defaultName", { month }),
        summary: {
          month,
          paid: latest.paid,
          benchmark: latest.benchmark,
          savings: latest.savings,
          lines: answers.agreementLines.map((line) => ({
            carrier: line.carrier,
            route: line.route,
            difference: line.difference,
          })),
        },
      }),
    });
    setSaved(true);
  }

  return (
    <div className="page">
      <h1>{t("check.title")}</h1>
      <p className="meta">{customer.name}</p>
      <p className="section-intro">{t("check.lead")}</p>
      <p>
        <button type="button" className="bill-choice" onClick={() => void save()}>
          {t("check.save")}
        </button>
        {saved ? <span className="hint"> {t("check.saved")}</span> : null}
      </p>
      <InvoiceCheck customer={customer} />
    </div>
  );
}
