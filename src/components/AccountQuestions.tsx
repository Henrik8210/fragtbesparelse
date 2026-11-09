import { carrierProfiles } from "../data/carriers.ts";
import { accountAnswers } from "../data/questions.ts";
import { LATEST_MONTH } from "../data/portfolio.ts";
import { formatCount, formatKr } from "../format.ts";
import type { Customer } from "../types.ts";

export function AccountQuestions({ customer }: { customer: Customer }) {
  const answers = accountAnswers(customer);
  const used = new Set(answers.carriers.map((carrier) => carrier.name));
  const busiest = answers.carriers[0];
  const toRaise = [...answers.carriers].sort((a, b) => b.agreementGap - a.agreementGap)[0];
  const onTheCard = answers.carriers.filter((carrier) => carrier.agreementGap === 0);

  return (
    <section className="block" id="questions">
      <h2>Three questions</h2>
      <p className="section-intro">
        {LATEST_MONTH} for {customer.name}. The figures are this account&apos;s sample invoices and sample fair
        price.
      </p>
      <ol className="questions">
        <li>
          <h3>Are we paying what we agreed?</h3>
          <p>
            {answers.agreementImpact === 0
              ? `Yes. The ${LATEST_MONTH} invoices match the signed rates on this account.`
              : `No. The ${LATEST_MONTH} invoices are ${formatKr(answers.agreementImpact)} above the signed rates. ${answers.agreementLines
                  .map((line) => `${line.carrier}, ${line.route}, ${formatKr(line.difference)}`)
                  .join(". ")}.`}
          </p>
        </li>
        <li>
          <h3>Is the agreement competitive?</h3>
          <p>
            {answers.ratesAboveFair <= 0
              ? `Yes. The signed rates match the sample fair price of ${formatKr(answers.fairPrice)} for these shipments. That price is sample data for this account.`
              : `No. The sample fair price for these shipments is ${formatKr(answers.fairPrice)}. The signed rates sit ${formatKr(answers.ratesAboveFair)} above that price. A further ${formatKr(answers.agreementImpact)} is the amount the invoices added on top of those rates. The fair price is sample data for this account.`}
          </p>
        </li>
        <li>
          <h3>Which carriers fit?</h3>
          <p>
            {busiest
              ? `${busiest.name} carries the most shipments here, ${formatCount(busiest.shipments)}.`
              : "No named carrier is on this account."}{" "}
            {toRaise && toRaise.agreementGap > 0
              ? `${toRaise.name} is the carrier to raise the rate card with: ${formatKr(toRaise.agreementGap)} over the signed rates.`
              : "No named carrier is over the signed rates."}{" "}
            {onTheCard.length > 0
              ? `${listNames(onTheCard.map((carrier) => carrier.name))} ${onTheCard.length === 1 ? "matches" : "match"} the rate card. Any remaining gap on those lanes is the service that was used.`
              : "Every named carrier on this account has a rate-card difference."}{" "}
            {answers.splitRoutes.length > 0
              ? `${answers.splitRoutes.join(" and ")} ${answers.splitRoutes.length === 1 ? "is" : "are"} split across more than one carrier, so no single carrier owns ${answers.splitRoutes.length === 1 ? "that lane" : "those lanes"}.`
              : ""}
          </p>
        </li>
      </ol>
      <h3 className="profile-heading">Carrier profiles</h3>
      <p className="section-intro">
        Each note says how that carrier&apos;s sample invoice is shaped. The note does not read a file.
      </p>
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

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
