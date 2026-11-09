import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { withBillSpend } from "../bills/spend.ts";
import { useBills } from "../bills.tsx";
import { useSession } from "../session.tsx";
import { AccountQuestions } from "../components/AccountQuestions.tsx";
import { Figures } from "../components/Figures.tsx";
import { InvoiceCheck } from "../components/InvoiceCheck.tsx";
import { MonthBudgetChart } from "../components/MonthBudgetChart.tsx";
import { TrendChart } from "../components/TrendChart.tsx";
import {
  CAUSES,
  LATEST_MONTH,
  MONTHS,
  currentMonthTrack,
  customers,
  latestFromLanes,
  savingsByCause,
} from "../data/portfolio.ts";
import { formatCount, formatKr, formatPercent } from "../format.ts";
import { useLanguage } from "../language.tsx";
import type { MessageKey } from "../i18n/messages.ts";
import type { CauseId, Customer } from "../types.ts";
import { NotFound } from "./NotFound.tsx";

type Filter = "all" | "clean" | CauseId;

const causeTitleKey: Record<CauseId, MessageKey> = {
  express: "cause.express.title",
  consolidation: "cause.consolidation.title",
  dimensional: "cause.dimensional.title",
  fuel: "cause.fuel.title",
  contract: "cause.contract.title",
  split: "cause.split.title",
};

const causeShortKey: Record<CauseId, MessageKey> = {
  express: "cause.express.short",
  consolidation: "cause.consolidation.short",
  dimensional: "cause.dimensional.short",
  fuel: "cause.fuel.short",
  contract: "cause.contract.short",
  split: "cause.split.short",
};

export function CustomerPage() {
  const { customerId } = useParams();
  const { session } = useSession();
  const { t } = useLanguage();
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) {
    return <NotFound title={t("notFound.noCompany")} body={t("notFound.noCompanyBody")} />;
  }
  if (!session) {
    return <NotFound title={t("notFound.signIn")} body={t("notFound.signInBody", { name: customer.name })} />;
  }
  if (session.role === "customer" && session.customerId !== customer.id) {
    return <NotFound title={t("notFound.notYours")} body={t("notFound.notYoursBody")} />;
  }
  return <CustomerDetail key={customer.id} customer={customer} />;
}

function CustomerDetail({ customer }: { customer: Customer }) {
  const { session } = useSession();
  const { t, phrase } = useLanguage();
  const [filter, setFilter] = useState<Filter>("all");
  const latest = latestFromLanes(customer);
  const { total: billTotal } = useBills(customer.id);
  const monthTrack = withBillSpend(currentMonthTrack(customer), billTotal);
  const againstBudget = monthTrack.spent - monthTrack.budget;
  const causes = savingsByCause(customer);
  const maxCause = Math.max(...causes.map((cause) => cause.amount));
  const hasClean = customer.lanes.some((lane) => lane.causeId === null);
  const latestMonth = phrase(`month.${MONTHS[MONTHS.length - 1].id}`, LATEST_MONTH);
  const rangeLabel = t("customer.range", {
    from: phrase(`month.${MONTHS[0].id}`, MONTHS[0].label),
    to: latestMonth,
  });

  useEffect(() => {
    document.title = `${customer.name} · Fairlane`;
  }, [customer.name]);

  const filtered = useMemo(() => {
    if (filter === "all") return customer.lanes;
    if (filter === "clean") return customer.lanes.filter((lane) => lane.causeId === null);
    return customer.lanes.filter((lane) => lane.causeId === filter);
  }, [customer.lanes, filter]);

  const shown = filtered.reduce(
    (totals, lane) => ({
      shipments: totals.shipments + lane.shipments,
      paid: totals.paid + lane.paid,
      benchmark: totals.benchmark + lane.benchmark,
    }),
    { shipments: 0, paid: 0, benchmark: 0 },
  );

  return (
    <div className="page" id="overview">
      <h1>{customer.name}</h1>
      <p className="meta">
        {customer.industry === "Ecommerce" ? t("industry.Ecommerce") : t("industry.Manufacturing")} · {customer.place}
      </p>
      {session?.role === "admin" ? (
        <p className="back">
          <Link className="text-link" to="/">
            {t("account.all")}
          </Link>
        </p>
      ) : null}
      <p className="lede">
        {phrase(`desc.${customer.id}`, customer.description)}{" "}
        {billTotal > 0
          ? t("customer.billsLede", { amount: formatKr(billTotal) })
          : t("customer.sampleLede")}
      </p>
      <AccountQuestions customer={customer} />
      <section className="block" id="budget">
        <h2>{t("customer.budgetTitle")}</h2>
        <p className="section-intro">
          {t("customer.budgetIntro", {
            month: latestMonth,
            bills: billTotal > 0 ? t("customer.budgetBills") : "",
            spent: formatKr(monthTrack.spent),
            budget: formatKr(monthTrack.budget),
          })}{" "}
          {againstBudget === 0
            ? t("customer.budgetMatch")
            : againstBudget > 0
              ? t("customer.budgetOver", { amount: formatKr(againstBudget) })
              : t("customer.budgetUnder", { amount: formatKr(Math.abs(againstBudget)) })}
        </p>
        <MonthBudgetChart points={monthTrack.points} monthLabel={latestMonth} />
        <div className="table-wrap">
          <table className="months">
            <caption className="sr-only">
              {t("customer.budgetCaption", { name: customer.name, month: latestMonth })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("customer.through")}</th>
                <th scope="col" className="num">
                  {t("common.spend")}
                </th>
                <th scope="col" className="num">
                  {t("common.budget")}
                </th>
              </tr>
            </thead>
            <tbody>
              {monthTrack.points.map((point) => (
                <tr key={point.label} className={point.label === "Month end" ? "is-latest" : undefined}>
                  <th scope="row">{phrase(`week.${point.label}`, point.label)}</th>
                  <td className="num">{formatKr(point.spent)}</td>
                  <td className="num">{formatKr(point.budget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
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

      <InvoiceCheck customer={customer} />

      <section className="block" id="trend">
        <h2>{t("customer.trend")}</h2>
        <p className="section-intro">
          {t("customer.trendIntro", { range: rangeLabel })}
          {billTotal > 0 ? t("customer.trendBills", { month: latestMonth, amount: formatKr(billTotal) }) : ""}
        </p>
        <TrendChart
          labels={MONTHS.map((month) => phrase(`monthShort.${month.id}`, month.short))}
          points={customer.months}
          rangeLabel={rangeLabel}
        />
        <ul className="month-cards">
          {customer.months.map((month, index) => {
            const label = MONTHS[index];
            const isLatest = index === customer.months.length - 1;
            const paid = isLatest ? month.paid + billTotal : month.paid;
            const savings = month.paid - month.benchmark;
            return (
              <li key={label.id} className={isLatest ? "card is-latest" : "card"}>
                <span className="card-title">
                  {phrase(`month.${label.id}`, label.label)}
                  {isLatest ? <span className="latest-tag">{t("common.latest")}</span> : null}
                </span>
                <span className="card-stats">
                  <span>
                    <span className="card-label">{t("common.paid")}</span>
                    {formatKr(paid)}
                  </span>
                  <span>
                    <span className="card-label">{t("common.benchmark")}</span>
                    {formatKr(month.benchmark)}
                  </span>
                  <span>
                    <span className="card-label">{t("common.savings")}</span>
                    {formatKr(savings)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="table-wrap desktop-only">
          <table className="months">
            <caption className="sr-only">
              {t("customer.monthCaption", { name: customer.name, range: rangeLabel })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("common.month")}</th>
                <th scope="col" className="num">
                  {t("common.paid")}
                </th>
                <th scope="col" className="num">
                  {t("common.benchmark")}
                </th>
                <th scope="col" className="num">
                  {t("common.savings")}
                </th>
              </tr>
            </thead>
            <tbody>
              {customer.months.map((month, index) => {
                const label = MONTHS[index];
                const isLatest = index === customer.months.length - 1;
                const paid = isLatest ? month.paid + billTotal : month.paid;
                const savings = month.paid - month.benchmark;
                return (
                  <tr key={label.id} className={isLatest ? "is-latest" : undefined}>
                    <th scope="row">
                      {phrase(`month.${label.id}`, label.label)}
                      {isLatest ? <span className="latest-tag">{t("common.latest")}</span> : null}
                    </th>
                    <td className="num">{formatKr(paid)}</td>
                    <td className="num">{formatKr(month.benchmark)}</td>
                    <td className="num">{formatKr(savings)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block" id="savings">
        <h2>{t("customer.causes")}</h2>
        <p className="section-intro">{t("customer.causesIntro", { month: latestMonth })}</p>
        <ol className="causes">
          {causes.map((cause) => (
            <li key={cause.id}>
              <div className="cause-top">
                <h3>{t(causeTitleKey[cause.id])}</h3>
                <p className="cause-amount">{formatKr(cause.amount)}</p>
              </div>
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${(cause.amount / maxCause) * 100}%` }} />
              </div>
              <p className="cause-share">
                {formatPercent(cause.amount / latest.savings)} {t("common.ofSavings")}
              </p>
              <p className="explanation">{phrase(`explain.${customer.id}.${cause.id}`, cause.explanation)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="block" id="lanes">
        <h2>{t("customer.lanes")}</h2>
        <p className="section-intro">
          {filter === "all"
            ? t("customer.lanesAll", { month: latestMonth })
            : filter === "clean"
              ? t("customer.lanesClean", { month: latestMonth })
              : t("customer.lanesCause", { month: latestMonth })}
        </p>
        <div className="filters" role="group" aria-label={t("customer.filter")}>
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            {t("common.allLines")} <span className="filter-count">{customer.lanes.length}</span>
          </button>
          {CAUSES.map((cause) => {
            const count = customer.lanes.filter((lane) => lane.causeId === cause.id).length;
            if (count === 0) return null;
            return (
              <button
                key={cause.id}
                type="button"
                aria-pressed={filter === cause.id}
                onClick={() => setFilter(cause.id)}
              >
                {t(causeShortKey[cause.id])} <span className="filter-count">{count}</span>
              </button>
            );
          })}
          {hasClean ? (
            <button type="button" aria-pressed={filter === "clean"} onClick={() => setFilter("clean")}>
              {t("cause.clean")}{" "}
              <span className="filter-count">
                {customer.lanes.filter((lane) => lane.causeId === null).length}
              </span>
            </button>
          ) : null}
        </div>
        <ul className="lane-cards">
          {filtered.map((lane) => {
            const savings = lane.paid - lane.benchmark;
            return (
              <li key={`${lane.origin}-${lane.destination}-${lane.carrier}-${lane.service}`} className="card">
                <span className="card-title">
                  {lane.origin} {t("common.to")} {phrase(`place.${lane.destination}`, lane.destination)}
                </span>
                <span className="company-meta">
                  {phrase(`carrier.${lane.carrier}`, lane.carrier)} · {phrase(`service.${lane.service}`, lane.service)}
                </span>
                <span className="card-stats">
                  <span>
                    <span className="card-label">{t("common.shipments")}</span>
                    {formatCount(lane.shipments)}
                  </span>
                  <span>
                    <span className="card-label">{t("common.paid")}</span>
                    {formatKr(lane.paid)}
                  </span>
                  <span>
                    <span className="card-label">{t("common.benchmark")}</span>
                    {formatKr(lane.benchmark)}
                  </span>
                  <span>
                    <span className="card-label">{t("common.savings")}</span>
                    {formatKr(savings)}
                  </span>
                </span>
                <span className="card-cause">{lane.causeId ? t(causeShortKey[lane.causeId]) : t("cause.clean")}</span>
              </li>
            );
          })}
        </ul>
        <div className="table-wrap desktop-only">
          <table className="lines">
            <caption className="sr-only">
              {t("customer.laneCaption", { name: customer.name, month: latestMonth })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("common.lane")}</th>
                <th scope="col">{t("common.carrier")}</th>
                <th scope="col" className="num">
                  {t("common.shipments")}
                </th>
                <th scope="col" className="num">
                  {t("common.paid")}
                </th>
                <th scope="col" className="num">
                  {t("common.benchmark")}
                </th>
                <th scope="col" className="num">
                  {t("common.savings")}
                </th>
                <th scope="col">{t("common.cause")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lane) => {
                const savings = lane.paid - lane.benchmark;
                return (
                  <tr key={`${lane.origin}-${lane.destination}-${lane.carrier}-${lane.service}`}>
                    <th scope="row">
                      {lane.origin} {t("common.to")} {phrase(`place.${lane.destination}`, lane.destination)}
                    </th>
                    <td>
                      <span className="carrier">{phrase(`carrier.${lane.carrier}`, lane.carrier)}</span>
                      <span className="service">{phrase(`service.${lane.service}`, lane.service)}</span>
                    </td>
                    <td className="num">{formatCount(lane.shipments)}</td>
                    <td className="num">{formatKr(lane.paid)}</td>
                    <td className="num">{formatKr(lane.benchmark)}</td>
                    <td className="num">{formatKr(savings)}</td>
                    <td>{lane.causeId ? t(causeShortKey[lane.causeId]) : t("cause.clean")}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{filter === "all" ? t("common.allLines") : t("common.shownLines")}</th>
                <td />
                <td className="num">{formatCount(shown.shipments)}</td>
                <td className="num">{formatKr(shown.paid)}</td>
                <td className="num">{formatKr(shown.benchmark)}</td>
                <td className="num">{formatKr(shown.paid - shown.benchmark)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
