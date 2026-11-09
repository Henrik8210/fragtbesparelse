import { useState } from "react";
import { useBills } from "../bills.tsx";
import { accountAnswers, type AgreementLine } from "../data/questions.ts";
import { LATEST_MONTH, MONTHS } from "../data/portfolio.ts";
import { formatKr } from "../format.ts";
import { useInvoiceReview, type ReviewState } from "../invoiceReview.tsx";
import { useLanguage } from "../language.tsx";
import type { Customer } from "../types.ts";

const SAMPLE_BILL = "sample";

export function InvoiceCheck({ customer }: { customer: Customer }) {
  const { t, phrase } = useLanguage();
  const answers = accountAnswers(customer);
  const { bills } = useBills(customer.id);
  const { reviewFor, setReview } = useInvoiceReview(customer.id);
  const [selected, setSelected] = useState(SAMPLE_BILL);
  const uploaded = bills.find((bill) => bill.id === selected);
  const showingSample = selected === SAMPLE_BILL || !uploaded;

  return (
    <section className="block" id="invoice-check">
      <h2>{t("invoice.title")}</h2>
      <p className="section-intro">
        {t("invoice.intro", { month: phrase(`month.${MONTHS[MONTHS.length - 1].id}`, LATEST_MONTH) })}
      </p>
      {bills.length > 0 ? (
        <label className="bill-field invoice-picker">
          <span>{t("invoice.bill")}</span>
          <select value={showingSample ? SAMPLE_BILL : selected} onChange={(event) => setSelected(event.target.value)}>
            <option value={SAMPLE_BILL}>{t("invoice.sample")}</option>
            {bills.map((bill) => (
              <option key={bill.id} value={bill.id}>
                {bill.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {showingSample ? (
        <SampleLines lines={answers.agreementLines} reviewFor={reviewFor} setReview={setReview} />
      ) : uploaded ? (
        <UploadedBill
          label={uploaded.label}
          amount={uploaded.amount}
          state={reviewFor(`bill:${uploaded.id}`, "open")}
          onChange={(state) => setReview(`bill:${uploaded.id}`, state)}
        />
      ) : null}
    </section>
  );
}

function SampleLines({
  lines,
  reviewFor,
  setReview,
}: {
  lines: AgreementLine[];
  reviewFor: (key: string, fallback: ReviewState) => ReviewState;
  setReview: (key: string, state: ReviewState) => void;
}) {
  const { t } = useLanguage();
  const impact = lines.reduce((sum, line) => sum + line.difference, 0);
  return (
    <>
      <p className="section-intro">{t("invoice.linesIntro", { amount: formatKr(impact) })}</p>
      <div className="table-wrap">
        <table className="invoice-lines">
          <caption className="sr-only">{t("invoice.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("common.line")}</th>
              <th scope="col">{t("common.carrier")}</th>
              <th scope="col" className="num">
                {t("invoice.invoiced")}
              </th>
              <th scope="col" className="num">
                {t("invoice.agreed")}
              </th>
              <th scope="col" className="num">
                {t("invoice.difference")}
              </th>
              <th scope="col">{t("invoice.review")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const state = reviewFor(`line:${line.id}`, "open");
              return (
                <tr key={line.id}>
                  <th scope="row">
                    {line.route}
                    <span className="seat-person-role">{line.service}</span>
                  </th>
                  <td>{line.carrier}</td>
                  <td className="num">{formatKr(line.invoiced)}</td>
                  <td className="num">{formatKr(line.agreed)}</td>
                  <td className="num">{formatKr(line.difference)}</td>
                  <td>
                    <p className="review-label">{state === "open" ? t("invoice.open") : t("invoice.accepted")}</p>
                    <p className="review-hint">{t("invoice.raise", { carrier: line.carrier })}</p>
                    <button
                      type="button"
                      className="bill-remove"
                      onClick={() => setReview(`line:${line.id}`, state === "open" ? "accepted" : "open")}
                    >
                      {state === "open" ? t("invoice.markAccepted") : t("invoice.reopen")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UploadedBill({
  label,
  amount,
  state,
  onChange,
}: {
  label: string;
  amount: number;
  state: ReviewState;
  onChange: (state: ReviewState) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="uploaded-check">
      <p className="section-intro">{t("invoice.uploaded", { label, amount: formatKr(amount) })}</p>
      <p className="review-label">{state === "open" ? t("invoice.open") : t("invoice.accepted")}</p>
      <button type="button" className="bill-choice" onClick={() => onChange(state === "open" ? "accepted" : "open")}>
        {state === "open" ? t("invoice.markAccepted") : t("invoice.reopen")}
      </button>
    </div>
  );
}
