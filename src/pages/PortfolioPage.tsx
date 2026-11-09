import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBillTotals } from "../bills.tsx";
import { Figures } from "../components/Figures.tsx";
import { LATEST_MONTH, MONTHS, customers, latestFromLanes, portfolioTotals } from "../data/portfolio.ts";
import { formatKr, formatPercent } from "../format.ts";
import { useLanguage } from "../language.tsx";
import type { Industry } from "../types.ts";

type SortKey = "name" | "paid" | "benchmark" | "savings" | "rate";
type SortDir = "asc" | "desc";

export function PortfolioPage() {
  const navigate = useNavigate();
  const { t, phrase, lang } = useLanguage();
  const month = phrase(`month.${MONTHS[MONTHS.length - 1].id}`, LATEST_MONTH);
  const totals = portfolioTotals();
  const billTotals = useBillTotals();
  const billsAdded = customers.reduce((sum, customer) => sum + (billTotals[customer.id] ?? 0), 0);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "savings",
    dir: "desc",
  });

  useEffect(() => {
    document.title = t("portfolio.docTitle");
  }, [t]);

  const rows = useMemo(() => {
    const next = customers.map((customer) => {
      const latest = latestFromLanes(customer);
      const paid = latest.paid + (billTotals[customer.id] ?? 0);
      return { customer, ...latest, paid, rate: latest.savings / paid };
    });
    const factor = sort.dir === "asc" ? 1 : -1;
    next.sort((a, b) => {
      if (sort.key === "name") {
        return a.customer.name.localeCompare(b.customer.name, lang === "da" ? "da" : "en") * factor;
      }
      return (a[sort.key] - b[sort.key]) * factor;
    });
    return next;
  }, [billTotals, lang, sort]);

  const maxRate = Math.max(...rows.map((row) => row.rate));

  function onSort(key: SortKey) {
    setSort((current) => {
      if (current.key === key) {
        return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: key === "name" ? "asc" : "desc" };
    });
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    if (sort.key !== key) return "none";
    return sort.dir === "asc" ? "ascending" : "descending";
  }

  function mark(key: SortKey): string {
    if (sort.key !== key) return "";
    return sort.dir === "asc" ? "↑" : "↓";
  }

  return (
    <div className="page">
      <h1>{t("portfolio.title")}</h1>
      <p className="lede">
        {t("portfolio.lede", { month })}{" "}
        {billsAdded > 0 ? t("portfolio.bills", { amount: formatKr(billsAdded) }) : t("portfolio.sample")}
      </p>
      <Figures
        kicker={t("portfolio.kicker", { month, count: customers.length })}
        items={[
          {
            label: t("common.paid"),
            value: formatKr(totals.paid + billsAdded),
            hint: billsAdded > 0 ? t("portfolio.invoicesPlus", { amount: formatKr(billsAdded) }) : t("portfolio.invoices"),
          },
          {
            label: t("common.benchmark"),
            value: formatKr(totals.benchmark),
            hint: t("portfolio.benchmarkHint"),
          },
          {
            label: t("common.addressable"),
            value: formatKr(totals.savings),
            hint: t("portfolio.savingsHint", { rate: formatPercent(totals.savings / (totals.paid + billsAdded)) }),
            emphasis: true,
          },
        ]}
      />
      <section className="block">
        <h2>{t("portfolio.companies")}</h2>
        <ul className="company-cards">
          {rows.map((row) => (
            <li key={row.customer.id}>
              <Link className="card" to={`/customers/${row.customer.id}`}>
                <span className="card-title">{row.customer.name}</span>
                <span className="company-meta">
                  {industryName(row.customer.industry, t)} · {phrase(`place.${row.customer.place}`, row.customer.place)}
                </span>
                <span className="card-stats">
                  <span>
                    <span className="card-label">{t("common.paid")}</span>
                    {formatKr(row.paid)}
                  </span>
                  <span>
                    <span className="card-label">{t("common.benchmark")}</span>
                    {formatKr(row.benchmark)}
                  </span>
                  <span>
                    <span className="card-label">{t("common.savings")}</span>
                    <strong className="is-savings">{formatKr(row.savings)}</strong>
                  </span>
                  <span>
                    <span className="card-label">{t("common.ofPaid")}</span>
                    {formatPercent(row.rate)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="table-wrap desktop-only">
          <table className="companies">
            <caption className="sr-only">
              {t("portfolio.caption", { month })}
            </caption>
            <thead>
              <tr>
                <th scope="col" aria-sort={ariaSort("name")}>
                  <button type="button" onClick={() => onSort("name")}>
                    {t("common.company")} <span className="sort-mark" aria-hidden="true">{mark("name")}</span>
                  </button>
                </th>
                <th scope="col" className="num" aria-sort={ariaSort("paid")}>
                  <button type="button" onClick={() => onSort("paid")}>
                    {t("common.paid")} <span className="sort-mark" aria-hidden="true">{mark("paid")}</span>
                  </button>
                </th>
                <th scope="col" className="num" aria-sort={ariaSort("benchmark")}>
                  <button type="button" onClick={() => onSort("benchmark")}>
                    {t("common.benchmark")} <span className="sort-mark" aria-hidden="true">{mark("benchmark")}</span>
                  </button>
                </th>
                <th scope="col" className="num" aria-sort={ariaSort("savings")}>
                  <button type="button" onClick={() => onSort("savings")}>
                    {t("common.savings")} <span className="sort-mark" aria-hidden="true">{mark("savings")}</span>
                  </button>
                </th>
                <th scope="col" className="num" aria-sort={ariaSort("rate")}>
                  <button type="button" onClick={() => onSort("rate")}>
                    {t("common.ofPaid")} <span className="sort-mark" aria-hidden="true">{mark("rate")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.customer.id}
                  onClick={(event) => {
                    const target = event.target;
                    if (target instanceof Element && target.closest("a")) return;
                    navigate(`/customers/${row.customer.id}`);
                  }}
                >
                  <td>
                    <Link className="company-link" to={`/customers/${row.customer.id}`}>
                      {row.customer.name}
                    </Link>
                    <span className="company-meta">
                      {industryName(row.customer.industry, t)} · {phrase(`place.${row.customer.place}`, row.customer.place)}
                    </span>
                  </td>
                  <td className="num">{formatKr(row.paid)}</td>
                  <td className="num">{formatKr(row.benchmark)}</td>
                  <td className="num">{formatKr(row.savings)}</td>
                  <td className="num">
                    <div className="rate">
                      <span>{formatPercent(row.rate)}</span>
                      <span className="meter" aria-hidden="true">
                        <span style={{ width: `${(row.rate / maxRate) * 100}%` }} />
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="wayfinding">
          {t("portfolio.wayfinding")}
        </p>
      </section>
    </div>
  );
}

function industryName(industry: Industry, t: (key: "industry.Ecommerce" | "industry.Manufacturing") => string): string {
  return industry === "Ecommerce" ? t("industry.Ecommerce") : t("industry.Manufacturing");
}
