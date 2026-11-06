import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Figures } from "../components/Figures.tsx";
import { LATEST_MONTH, customers, latestFromLanes, portfolioTotals } from "../data/portfolio.ts";
import { formatKr, formatPercent } from "../format.ts";

type SortKey = "name" | "paid" | "benchmark" | "savings" | "rate";
type SortDir = "asc" | "desc";

export function PortfolioPage() {
  const navigate = useNavigate();
  const totals = portfolioTotals();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "savings",
    dir: "desc",
  });

  useEffect(() => {
    document.title = "Portfolio · Fairlane";
  }, []);

  const rows = useMemo(() => {
    const next = customers.map((customer) => {
      const latest = latestFromLanes(customer);
      return { customer, ...latest, rate: latest.savings / latest.paid };
    });
    const factor = sort.dir === "asc" ? 1 : -1;
    next.sort((a, b) => {
      if (sort.key === "name") {
        return a.customer.name.localeCompare(b.customer.name, "en") * factor;
      }
      return (a[sort.key] - b[sort.key]) * factor;
    });
    return next;
  }, [sort]);

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
      <h1>Portfolio</h1>
      <p className="lede">
        Freight paid by fictional ecommerce and manufacturing companies, a sample benchmark for the
        same shipments, and the gap. {LATEST_MONTH} is the latest month. Every figure on this screen
        is Fairlane sample data.
      </p>
      <Figures
        kicker={`${LATEST_MONTH} · ${customers.length} companies`}
        items={[
          { label: "Paid", value: formatKr(totals.paid), hint: "Sample invoices" },
          {
            label: "Benchmark",
            value: formatKr(totals.benchmark),
            hint: "Sample fair price, not a quote",
          },
          {
            label: "Addressable savings",
            value: formatKr(totals.savings),
            hint: `${formatPercent(totals.savings / totals.paid)} of paid`,
            emphasis: true,
          },
        ]}
      />
      <section className="block">
        <h2>Companies</h2>
        <ul className="company-cards">
          {rows.map((row) => (
            <li key={row.customer.id}>
              <Link className="card" to={`/customers/${row.customer.id}`}>
                <span className="card-title">{row.customer.name}</span>
                <span className="company-meta">
                  {row.customer.industry} · {row.customer.place}
                </span>
                <span className="card-stats">
                  <span>
                    <span className="card-label">Paid</span>
                    {formatKr(row.paid)}
                  </span>
                  <span>
                    <span className="card-label">Benchmark</span>
                    {formatKr(row.benchmark)}
                  </span>
                  <span>
                    <span className="card-label">Savings</span>
                    <strong className="is-savings">{formatKr(row.savings)}</strong>
                  </span>
                  <span>
                    <span className="card-label">Of paid</span>
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
              Fairlane sample companies for {LATEST_MONTH}, with paid freight, benchmark, and savings
            </caption>
            <thead>
              <tr>
                <th scope="col" aria-sort={ariaSort("name")}>
                  <button type="button" onClick={() => onSort("name")}>
                    Company <span className="sort-mark" aria-hidden="true">{mark("name")}</span>
                  </button>
                </th>
                <th scope="col" className="num" aria-sort={ariaSort("paid")}>
                  <button type="button" onClick={() => onSort("paid")}>
                    Paid <span className="sort-mark" aria-hidden="true">{mark("paid")}</span>
                  </button>
                </th>
                <th scope="col" className="num" aria-sort={ariaSort("benchmark")}>
                  <button type="button" onClick={() => onSort("benchmark")}>
                    Benchmark <span className="sort-mark" aria-hidden="true">{mark("benchmark")}</span>
                  </button>
                </th>
                <th scope="col" className="num" aria-sort={ariaSort("savings")}>
                  <button type="button" onClick={() => onSort("savings")}>
                    Savings <span className="sort-mark" aria-hidden="true">{mark("savings")}</span>
                  </button>
                </th>
                <th scope="col" className="num" aria-sort={ariaSort("rate")}>
                  <button type="button" onClick={() => onSort("rate")}>
                    Of paid <span className="sort-mark" aria-hidden="true">{mark("rate")}</span>
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
                      {row.customer.industry} · {row.customer.place}
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
          Open a company to see the twelve-month trend, why the gap exists, and the lanes behind the
          total.
        </p>
      </section>
    </div>
  );
}
