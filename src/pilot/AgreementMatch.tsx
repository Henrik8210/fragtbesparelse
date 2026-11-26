import { CalendarClock, CircleAlert, FileWarning, Plus } from "lucide-react";
import { NO_MATCH_LABELS, periodLabel, sameCarrier, type InvoiceMatch, type NoMatchReason } from "./agreementDating.ts";
import type { Agreement } from "./agreements.ts";

const DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Copenhagen" });
const dayLabel = (value: string) => DAY.format(new Date(`${value}T12:00:00Z`));
const lines = (count: number) => `${count} ${count === 1 ? "linje" : "linjer"}`;

const OTHER_REASONS: NoMatchReason[] = ["before-first", "gap", "no-agreement", "no-date"];

/**
 * Which price agreement an invoice is checked against: the one valid on each line's date, or the one a person chose.
 * A line later than the newest agreement holds the invoice until that agreement is added.
 */
export function AgreementMatch({ match, agreements, carrier, choice, saving = false, problem = "", onChoose, onAdd }: {
  match: InvoiceMatch;
  agreements: Agreement[];
  carrier: string;
  choice?: { chosenByName: string } | null;
  saving?: boolean;
  problem?: string;
  onChoose: (agreementId: string) => void;
  onAdd: (carrier: string) => void;
}) {
  const byId = new Map(agreements.map((item) => [item.id, item]));
  const priced = agreements.filter((item) => item.rows.length)
    .sort((left, right) => Number(sameCarrier(right.carrier, carrier)) - Number(sameCarrier(left.carrier, carrier))
      || (right.from || "").localeCompare(left.from || ""));
  const name = (item: Agreement) => item.name;
  const unmatched = OTHER_REASONS.filter((reason) => match.missing[reason]);
  const who = carrier.trim() || "transportøren";
  return (
    <section className={`agreement-match${match.held ? " held" : ""}`} aria-label="Prisaftale for fakturaen">
      {match.held ? (
        <div className="match-held" role="alert">
          <FileWarning size={20} />
          <div>
            <strong>Upload den nye prisaftale med {who} først</strong>
            <p>
              {lines(match.missing["after-last"] ?? 0)} er dateret efter {match.lastEnd ? dayLabel(match.lastEnd) : "den seneste prisaftale"}, hvor den seneste prisaftale med {who} udløb.
              {" "}Fakturaen sammenlignes ikke, før der findes en gyldig prisaftale. Når den er tilføjet, matches fakturaen igen af sig selv.
            </p>
          </div>
          <button type="button" className="button primary" onClick={() => onAdd(carrier)}><Plus size={16} /> Tilføj prisaftale</button>
        </div>
      ) : null}
      <div className="match-head">
        <CalendarClock size={17} />
        <div>
          <h3>Prisaftale</h3>
          {match.used.length === 0 && !match.held ? (
            <p className="match-none"><CircleAlert size={14} /> Ingen gyldig prisaftale. Fakturaen sammenlignes ikke.</p>
          ) : (
            <ul className="match-used">
              {match.used.map(({ agreementId, lines: count }) => {
                const item = byId.get(agreementId);
                if (!item) return null;
                return (
                  <li key={agreementId}>
                    <strong>{name(item)}</strong> · {periodLabel(item)}
                    {match.used.length > 1 || unmatched.length || match.held ? <span className="quiet"> · {lines(count)}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {match.override ? <p className="quiet">Valgt manuelt{choice ? ` af ${choice.chosenByName}` : ""}. Alle linjer sammenlignes med denne aftale.</p> : null}
          {!match.override && match.used.length > 1 ? <p className="quiet">Fakturaen dækker flere aftaleperioder. Hver linje sammenlignes med aftalen på sin dato.</p> : null}
          {match.overlap ? <p className="match-flag"><CircleAlert size={14} /> Flere prisaftaler gælder på samme dato. Aftalen med den seneste startdato er valgt. Vælg en anden nedenfor, hvis det er forkert.</p> : null}
          {unmatched.map((reason) => (
            <p key={reason} className="match-flag"><CircleAlert size={14} /> {lines(match.missing[reason] ?? 0)}: Ingen gyldig prisaftale ({NO_MATCH_LABELS[reason].toLowerCase()}). De sammenlignes ikke.</p>
          ))}
        </div>
        <label className="match-pick">
          <span>Vælg aftale</span>
          <select value={match.override ?? ""} disabled={saving} onChange={(event) => onChoose(event.target.value)}>
            <option value="">Automatisk efter dato</option>
            {priced.map((item) => <option key={item.id} value={item.id}>{name(item)} · {periodLabel(item)}</option>)}
          </select>
        </label>
      </div>
      {problem ? <p className="org-note" role="alert">{problem}</p> : null}
    </section>
  );
}
