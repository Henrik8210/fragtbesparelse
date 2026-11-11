import { AddInvoice } from "./AddInvoice.tsx";
import { useBills } from "../bills.tsx";
import { carrierProfiles } from "../data/carriers.ts";
import { carrierFitIndex, type CarrierScore } from "../data/fit.ts";
import { accountAnswers } from "../data/questions.ts";
import { LATEST_MONTH, MONTHS } from "../data/portfolio.ts";
import { formatKr } from "../format.ts";
import type { MessageKey } from "../i18n/messages.ts";
import { useLanguage } from "../language.tsx";
import type { Customer } from "../types.ts";

type OverRow = {
  name: string;
  over: number;
  added: number;
};

export function AccountQuestions({ customer }: { customer: Customer }) {
  const { t, phrase } = useLanguage();
  const answers = accountAnswers(customer);
  const { bills } = useBills(customer.id);
  const rows = overRows(answers.carriers, bills);
  const max = Math.max(1, ...rows.map((row) => row.over + row.added));
  const used = new Set(answers.carriers.map((carrier) => carrier.name));
  const fit = carrierFitIndex(customer);

  return (
    <section className="block" id="questions">
      <div className="section-tools">
        <h2>{t("questions.agreed")}</h2>
        <AddInvoice customerId={customer.id} />
      </div>
      <p className="section-intro">
        {t("questions.month", { month: phrase(`month.${MONTHS[MONTHS.length - 1].id}`, LATEST_MONTH) })}
      </p>
      {rows.length === 0 ? (
        <p className="section-intro">{t("questions.match")}</p>
      ) : (
        <figure className="agree-chart">
          <figcaption className="sr-only">{t("questions.caption", { name: customer.name })}</figcaption>
          <ul className="legend">
            <li>
              <span className="swatch swatch-paid" /> {t("questions.over")}
            </li>
            <li>
              <span className="swatch swatch-budget" /> {t("questions.added")}
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
                <p className="agree-note">{noteFor(row, t)}</p>
              </li>
            ))}
          </ul>
        </figure>
      )}

      <h3>{t("questions.competitive")}</h3>
      <p className="section-intro">
        {answers.ratesAboveFair <= 0
          ? t("questions.competitiveYes", { fair: formatKr(answers.fairPrice) })
          : t("questions.competitiveNo", { gap: formatKr(answers.ratesAboveFair), fair: formatKr(answers.fairPrice) })}
      </p>

      <h3>{t("questions.fit")}</h3>
      <p className="section-intro">{fitIntro(fit.similarNames, fit.marketGap, t)}</p>
      <ol className="fit-list">
        {fit.scores.map((score) => (
          <li key={score.name}>
            <span className="fit-score">
              <span className="sr-only">{t("questions.fitScore", { score: String(score.score) })}</span>
              <span aria-hidden="true">{score.score}</span>
            </span>
            <span className="fit-meter" aria-hidden="true">
              <span style={{ width: `${score.score}%` }} />
            </span>
            <span className="fit-copy">
              <span className="agree-name">{score.name}</span>
              <span className="fit-note">{fitNote(score, t)}</span>
            </span>
          </li>
        ))}
      </ol>

      <h3 className="profile-heading">{t("questions.profiles")}</h3>
      <ul className="profile-list">
        {carrierProfiles.map((profile) => (
          <li key={profile.name}>
            <span className="seat-role">{profile.name}</span>
            <span className="profile-shape">{phrase(`shape.${profile.name}`, profile.shape)}</span>
            {used.has(profile.name) ? <span className="latest-tag">{t("questions.onAccount")}</span> : null}
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

function fitIntro(
  names: string[],
  marketGap: number,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (names.length === 0) return t("questions.fitNone");
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} ${t("common.and")} ${names[names.length - 1]}`;
  const sentence = marketGap > 0 ? t("questions.fitGap", { amount: formatKr(marketGap) }) : t("questions.fitNoGap");
  const gap = `${/[.!?]$/.test(who) ? " " : ". "}${sentence}`;
  return t("questions.fitIntro", { who, gap });
}

function fitNote(
  score: CarrierScore,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  const model = score.modelMatch ? "" : t("questions.poorModel");
  const prefer =
    score.similarCount === 0
      ? t("questions.noPeers")
      : t("questions.prefer", { prefer: score.preferCount, similar: score.similarCount, name: score.name });
  const price = !score.comparable ? "" : score.gapKr > 0 ? t("questions.above", { amount: formatKr(score.gapKr) }) : t("questions.noMore");
  return [model, prefer, price].filter(Boolean).join(" ");
}

function noteFor(
  row: OverRow,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  const raise = row.over > 0 ? t("questions.raise", { amount: formatKr(row.over), carrier: row.name }) : "";
  const added = row.added > 0 ? t("questions.addedAmount", { amount: formatKr(row.added) }) : "";
  return [raise, added].filter(Boolean).join(" · ");
}
