import { AddInvoice } from "./AddInvoice.tsx";
import { useBills } from "../bills.tsx";
import { carrierProfiles } from "../data/carriers.ts";
import { accountAnswers } from "../data/questions.ts";
import { LATEST_MONTH } from "../data/portfolio.ts";
import { formatCount, formatKr } from "../format.ts";
import type { Customer } from "../types.ts";

type OverRow = {
  name: string;
  over: number;
  added: number;
};

export function AccountQuestions({ customer }: { customer: Customer }) {
  const answers = accountAnswers(customer);
  const { bills } = useBills(customer.id);
  const rows = overRows(answers.carriers, bills);
  const max = Math.max(1, ...rows.map((row) => row.over + row.added));
  const used = new Set(answers.carriers.map((carrier) => carrier.name));
  const busiest = answers.carriers[0];
  const toRaise = [...answers.carriers].sort((a, b) => b.agreementGap - a.agreementGap)[0];

  return (
    <section className="block" id="questions">
      <div className="section-tools">
        <h2>Are we paying what we agreed?</h2>
        <AddInvoice customerId={customer.id} />
      </div>
      <p className="section-intro">{LATEST_MONTH}. Each bar is kroner over the signed rates.</p>
      {rows.length === 0 ? (
        <p className="section-intro">Invoices match the signed rates.</p>
      ) : (
        <figure className="agree-chart">
          <figcaption className="sr-only">
            Kroner over the signed agreement by carrier for {customer.name}.
          </figcaption>
          <ul className="legend">
            <li>
              <span className="swatch swatch-paid" /> Over the agreement
            </li>
            <li>
              <span className="swatch swatch-budget" /> Added invoice
            </li>
          </ul>
          <ul className="agree-rows">
            {rows.map((row) => (
              <li key={row.name}>
                <span className="agree-name">{row.name}</span>
                <span className="agree-track" aria-hidden="true">
                  {row.over > 0 ? (
                    <span className="agree-bar" style={{ width: `${(row.over / max) * 100}%` }} />
                  ) : null}
                  {row.added > 0 ? (
                    <span className="agree-added" style={{ width: `${(row.added / max) * 100}%` }} />
                  ) : null}
                </span>
                <p className="agree-note">{noteFor(row)}</p>
              </li>
            ))}
          </ul>
        </figure>
      )}

      <h3>Is the agreement competitive?</h3>
      <p className="section-intro">
        {answers.ratesAboveFair <= 0
          ? `Signed rates match this account's sample fair price of ${formatKr(answers.fairPrice)}.`
          : `Signed rates sit ${formatKr(answers.ratesAboveFair)} above this account's sample fair price of ${formatKr(answers.fairPrice)}.`}
      </p>

      <h3>Which carriers fit?</h3>
      <p className="section-intro">
        {busiest ? `${busiest.name} carries the most shipments, ${formatCount(busiest.shipments)}.` : "No named carrier is on this account."}{" "}
        {toRaise && toRaise.agreementGap > 0
          ? `Raise the rate card with ${toRaise.name}.`
          : "No named carrier is over the signed rates."}
      </p>

      <h3 className="profile-heading">Carrier profiles</h3>
      <ul className="profile-list">
        {carrierProfiles.map((profile) => (
          <li key={profile.name}>
            <span className="seat-role">{profile.name}</span>
            <span className="profile-shape">{profile.shape}</span>
            {used.has(profile.name) ? <span className="latest-tag">On this account</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function overRows(
  carriers: { name: string; agreementGap: number }[],
  bills: { carrier?: string; amount: number }[],
): OverRow[] {
  const byName = new Map<string, OverRow>();
  for (const carrier of carriers) {
    if (carrier.agreementGap <= 0) continue;
    byName.set(carrier.name, { name: carrier.name, over: carrier.agreementGap, added: 0 });
  }
  for (const bill of bills) {
    if (!bill.carrier) continue;
    const current = byName.get(bill.carrier) ?? { name: bill.carrier, over: 0, added: 0 };
    current.added += bill.amount;
    byName.set(bill.carrier, current);
  }
  return [...byName.values()].sort((a, b) => b.over + b.added - (a.over + a.added));
}

function noteFor(row: OverRow): string {
  const raise = row.over > 0 ? `${formatKr(row.over)} Raise with ${row.name}` : "";
  const added = row.added > 0 ? `${formatKr(row.added)} added` : "";
  return [raise, added].filter(Boolean).join(" · ");
}
