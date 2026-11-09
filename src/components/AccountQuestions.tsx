import { AddInvoice } from "./AddInvoice.tsx";
import { useBills } from "../bills.tsx";
import { carrierProfiles } from "../data/carriers.ts";
import { carrierFitIndex, type CarrierScore } from "../data/fit.ts";
import { accountAnswers } from "../data/questions.ts";
import { LATEST_MONTH } from "../data/portfolio.ts";
import { formatKr } from "../format.ts";
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
  const fit = carrierFitIndex(customer);

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
      <p className="section-intro">{fitIntro(fit.similarNames, fit.marketGap)}</p>
      <ol className="fit-list">
        {fit.scores.map((score) => (
          <li key={score.name}>
            <span className="fit-score">
              <span className="sr-only">Fit </span>
              {score.score}
              <span className="sr-only"> of 100</span>
            </span>
            <span className="fit-meter" aria-hidden="true">
              <span style={{ width: `${score.score}%` }} />
            </span>
            <span className="fit-copy">
              <span className="agree-name">{score.name}</span>
              <span className="fit-note">{fitNote(score)}</span>
            </span>
          </li>
        ))}
      </ol>

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

function fitIntro(names: string[], marketGap: number): string {
  if (names.length === 0) {
    return "Fit is 0–100 for this business. No other sample company in this trade shares these routes.";
  }
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const gap =
    marketGap > 0
      ? ` About ${formatKr(marketGap)} is where their prices sit below this account, the place a renegotiation would look.`
      : " On these routes this account pays no more than they do.";
  return `Fit is 0–100 for this business. Compared with ${who}.${gap}`;
}

function fitNote(score: CarrierScore): string {
  const model = score.modelMatch ? "" : "Payment model is a poor fit.";
  const prefer =
    score.similarCount === 0
      ? "No similar sample business ships these routes."
      : `${score.preferCount} of ${score.similarCount} similar businesses prefer ${score.name}.`;
  const price = !score.comparable
    ? ""
    : score.gapKr > 0
      ? `${formatKr(score.gapKr)} above what they pay.`
      : "Pays no more than they do.";
  return [model, prefer, price].filter(Boolean).join(" ");
}

function noteFor(row: OverRow): string {
  const raise = row.over > 0 ? `${formatKr(row.over)} Raise with ${row.name}` : "";
  const added = row.added > 0 ? `${formatKr(row.added)} added` : "";
  return [raise, added].filter(Boolean).join(" · ");
}
