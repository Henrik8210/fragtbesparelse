import { useEffect } from "react";
import { Link } from "react-router-dom";
import { withBillSpend } from "../bills/spend.ts";
import { useBills } from "../bills.tsx";
import { AccountQuestions } from "../components/AccountQuestions.tsx";
import { Figures } from "../components/Figures.tsx";
import { MonthBudgetChart } from "../components/MonthBudgetChart.tsx";
import { LATEST_MONTH, MONTHS, currentMonthTrack, latestFromLanes } from "../data/portfolio.ts";
import { formatKr, formatPercent } from "../format.ts";
import { useLanguage } from "../language.tsx";
import type { Customer } from "../types.ts";
import { GateView, useCustomerGate } from "./gate.tsx";
import { NotFound } from "./NotFound.tsx";

export function CustomerPage() {
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
  return <CustomerDetail customer={gate.customer} admin={gate.session.role === "admin"} />;
}

function CustomerDetail({ customer, admin }: { customer: Customer; admin: boolean }) {
  const { t, phrase } = useLanguage();
  const latest = latestFromLanes(customer);
  const { total: billTotal } = useBills(customer.id);
  const monthTrack = withBillSpend(currentMonthTrack(customer), billTotal);
  const latestMonth = phrase(`month.${MONTHS[MONTHS.length - 1].id}`, LATEST_MONTH);

  useEffect(() => {
    document.title = `${customer.name} · Fragtblik`;
  }, [customer.name]);

  return (
    <div className="page" id="overview">
      <h1>{customer.name}</h1>
      <p className="meta">
        {customer.industry === "Ecommerce" ? t("industry.Ecommerce") : t("industry.Manufacturing")} · {customer.place}
      </p>
      {admin ? (
        <p className="back">
          <Link className="text-link" to="/">
            {t("account.all")}
          </Link>
        </p>
      ) : null}
      <Figures
        kicker={t("customer.kicker", { month: latestMonth })}
        items={[
          {
            label: t("common.paid"),
            value: formatKr(latest.paid + billTotal),
            hint: billTotal > 0 ? t("common.samplePlusBills", { amount: formatKr(billTotal) }) : t("common.sampleInvoices"),
          },
          {
            label: t("common.benchmark"),
            value: formatKr(latest.benchmark),
            hint: t("common.fairHint"),
          },
          {
            label: t("common.addressable"),
            value: formatKr(latest.savings),
            hint: t("common.ofSampleInvoices", { percent: formatPercent(latest.savings / latest.paid) }),
            emphasis: true,
          },
        ]}
      />
      <p>
        <Link className="bill-choice" to={`/customers/${customer.id}/check`}>
          {t("overview.startCheck")}
        </Link>
      </p>
      <AccountQuestions customer={customer} />
      <section className="block" id="budget">
        <h2>{t("customer.budgetTitle")}</h2>
        <MonthBudgetChart points={monthTrack.points} monthLabel={latestMonth} />
      </section>
    </div>
  );
}
