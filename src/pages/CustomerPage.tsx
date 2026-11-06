import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { withBillSpend } from "../bills/spend.ts";
import { useBills } from "../bills.tsx";
import { useSession } from "../session.tsx";
import { Figures } from "../components/Figures.tsx";
import { MonthBudgetChart } from "../components/MonthBudgetChart.tsx";
import { TrendChart } from "../components/TrendChart.tsx";
import {
  CAUSES,
  LATEST_MONTH,
  MONTHS,
  causeLabel,
  currentMonthTrack,
  customers,
  latestFromLanes,
  savingsByCause,
} from "../data/portfolio.ts";
import { formatCount, formatKr, formatPercent } from "../format.ts";
import type { CauseId, Customer } from "../types.ts";
import { NotFound } from "./NotFound.tsx";

type Filter = "all" | "clean" | CauseId;

export function CustomerPage() {
  const { customerId } = useParams();
  const { session } = useSession();
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) {
    return (
      <NotFound
        title="No sample company matches that link"
        body="Fairlane sample data includes only the fictional companies in the portfolio."
      />
    );
  }
  if (!session) {
    return (
      <NotFound
        title="Sign in to open this account"
        body={`${customer.name} is a sample company. Use Log in in the upper right and choose that account, or sign in as a Fairlane admin. Figures stay hidden until you do.`}
      />
    );
  }
  if (session.role === "customer" && session.customerId !== customer.id) {
    return (
      <NotFound
        title="This account is not yours"
        body="A company sign-in shows only that company's savings. Sign in as a Fairlane admin to open every account."
      />
    );
  }
  return <CustomerDetail key={customer.id} customer={customer} />;
}

function CustomerDetail({ customer }: { customer: Customer }) {
  const { session } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const latest = latestFromLanes(customer);
  const { total: billTotal } = useBills(customer.id);
  const monthTrack = withBillSpend(currentMonthTrack(customer), billTotal);
  const againstBudget = monthTrack.spent - monthTrack.budget;
  const causes = savingsByCause(customer);
  const maxCause = Math.max(...causes.map((cause) => cause.amount));
  const hasClean = customer.lanes.some((lane) => lane.causeId === null);
  const rangeLabel = `${MONTHS[0].label} to ${LATEST_MONTH}`;

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
        {customer.industry} · {customer.place}
      </p>
      {session?.role === "admin" ? (
        <p className="back">
          <Link className="text-link" to="/">
            All accounts
          </Link>
        </p>
      ) : null}
      <p className="lede">
        {customer.description}{" "}
        {billTotal > 0
          ? `Sample figures, plus ${formatKr(billTotal)} from bills on this account.`
          : "Every figure on this screen is Fairlane sample data."}
      </p>
      <section className="block" id="budget">
        <h2>This month against the budget</h2>
        <p className="section-intro">
          {LATEST_MONTH}. The solid line is freight spend as the month goes on
          {billTotal > 0 ? ", with bills you added included at month end" : ""}. The dashed line is
          the budget projected for the full month. Spend finishes at {formatKr(monthTrack.spent)}.
          The budget is {formatKr(monthTrack.budget)}.{" "}
          {againstBudget === 0
            ? "Spend matches that budget."
            : againstBudget > 0
              ? `Spend is ${formatKr(againstBudget)} over that budget.`
              : `Spend is ${formatKr(Math.abs(againstBudget))} under that budget.`}
        </p>
        <MonthBudgetChart points={monthTrack.points} monthLabel={LATEST_MONTH} />
        <div className="table-wrap">
          <table className="months">
            <caption className="sr-only">
              Fairlane sample spend and budget for {customer.name} in {LATEST_MONTH}
            </caption>
            <thead>
              <tr>
                <th scope="col">Through</th>
                <th scope="col" className="num">
                  Spend
                </th>
                <th scope="col" className="num">
                  Budget
                </th>
              </tr>
            </thead>
            <tbody>
              {monthTrack.points.map((point) => (
                <tr key={point.label} className={point.label === "Month end" ? "is-latest" : undefined}>
                  <th scope="row">{point.label}</th>
                  <td className="num">{formatKr(point.spent)}</td>
                  <td className="num">{formatKr(point.budget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Figures
        kicker={`${LATEST_MONTH} · latest month`}
        items={[
          {
            label: "Paid",
            value: formatKr(latest.paid + billTotal),
            hint: billTotal > 0 ? `Sample invoices plus ${formatKr(billTotal)} from bills` : "Sample invoices",
          },
          {
            label: "Benchmark",
            value: formatKr(latest.benchmark),
            hint: "Sample fair price, not a carrier quote",
          },
          {
            label: "Addressable savings",
            value: formatKr(latest.savings),
            hint: `${formatPercent(latest.savings / latest.paid)} of the sample invoices`,
            emphasis: true,
          },
        ]}
      />

      <section className="block" id="trend">
        <h2>Twelve-month trend</h2>
        <p className="section-intro">
          {rangeLabel}. The shaded gap is the sample addressable savings in each month.
          {billTotal > 0 ? ` Paid in ${LATEST_MONTH} includes ${formatKr(billTotal)} from bills.` : ""}
        </p>
        <TrendChart
          labels={MONTHS.map((month) => month.short)}
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
                  {label.label}
                  {isLatest ? <span className="latest-tag">Latest</span> : null}
                </span>
                <span className="card-stats">
                  <span>
                    <span className="card-label">Paid</span>
                    {formatKr(paid)}
                  </span>
                  <span>
                    <span className="card-label">Benchmark</span>
                    {formatKr(month.benchmark)}
                  </span>
                  <span>
                    <span className="card-label">Savings</span>
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
              Fairlane sample data by month for {customer.name}, {rangeLabel}
            </caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="num">
                  Paid
                </th>
                <th scope="col" className="num">
                  Benchmark
                </th>
                <th scope="col" className="num">
                  Savings
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
                      {label.label}
                      {isLatest ? <span className="latest-tag">Latest</span> : null}
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
        <h2>Savings by cause</h2>
        <p className="section-intro">
          Where the {LATEST_MONTH} gap comes from, in words a buyer can check.
        </p>
        <ol className="causes">
          {causes.map((cause) => (
            <li key={cause.id}>
              <div className="cause-top">
                <h3>{cause.title}</h3>
                <p className="cause-amount">{formatKr(cause.amount)}</p>
              </div>
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${(cause.amount / maxCause) * 100}%` }} />
              </div>
              <p className="cause-share">{formatPercent(cause.amount / latest.savings)} of savings</p>
              <p className="explanation">{cause.explanation}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="block" id="lanes">
        <h2>Lanes and carriers</h2>
        <p className="section-intro">
          {filter === "all"
            ? `${LATEST_MONTH} shipment groups behind the total. The lines add up to the month.`
            : filter === "clean"
              ? `${LATEST_MONTH} shipment groups invoiced at the agreed rate. They are part of the month, not the whole of it.`
              : `${LATEST_MONTH} shipment groups for this cause. They are part of the month, not the whole of it.`}
        </p>
        <div className="filters" role="group" aria-label="Filter lanes by cause">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All lines <span className="filter-count">{customer.lanes.length}</span>
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
                {cause.short} <span className="filter-count">{count}</span>
              </button>
            );
          })}
          {hasClean ? (
            <button type="button" aria-pressed={filter === "clean"} onClick={() => setFilter("clean")}>
              At the agreed rate{" "}
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
                  {lane.origin} to {lane.destination}
                </span>
                <span className="company-meta">
                  {lane.carrier} · {lane.service}
                </span>
                <span className="card-stats">
                  <span>
                    <span className="card-label">Shipments</span>
                    {formatCount(lane.shipments)}
                  </span>
                  <span>
                    <span className="card-label">Paid</span>
                    {formatKr(lane.paid)}
                  </span>
                  <span>
                    <span className="card-label">Benchmark</span>
                    {formatKr(lane.benchmark)}
                  </span>
                  <span>
                    <span className="card-label">Savings</span>
                    {formatKr(savings)}
                  </span>
                </span>
                <span className="card-cause">{causeLabel(lane.causeId)}</span>
              </li>
            );
          })}
        </ul>
        <div className="table-wrap desktop-only">
          <table className="lines">
            <caption className="sr-only">
              Fairlane sample lanes for {customer.name} in {LATEST_MONTH}
            </caption>
            <thead>
              <tr>
                <th scope="col">Lane</th>
                <th scope="col">Carrier</th>
                <th scope="col" className="num">
                  Shipments
                </th>
                <th scope="col" className="num">
                  Paid
                </th>
                <th scope="col" className="num">
                  Benchmark
                </th>
                <th scope="col" className="num">
                  Savings
                </th>
                <th scope="col">Cause</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lane) => {
                const savings = lane.paid - lane.benchmark;
                return (
                  <tr key={`${lane.origin}-${lane.destination}-${lane.carrier}-${lane.service}`}>
                    <th scope="row">
                      {lane.origin} to {lane.destination}
                    </th>
                    <td>
                      <span className="carrier">{lane.carrier}</span>
                      <span className="service">{lane.service}</span>
                    </td>
                    <td className="num">{formatCount(lane.shipments)}</td>
                    <td className="num">{formatKr(lane.paid)}</td>
                    <td className="num">{formatKr(lane.benchmark)}</td>
                    <td className="num">{formatKr(savings)}</td>
                    <td>{causeLabel(lane.causeId)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{filter === "all" ? "All lines" : "Shown lines"}</th>
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
