import { useState } from "react";
import { useBills } from "../bills.tsx";
import { accountAnswers, type AgreementLine } from "../data/questions.ts";
import { LATEST_MONTH } from "../data/portfolio.ts";
import { formatKr } from "../format.ts";
import { useInvoiceReview, type ReviewState } from "../invoiceReview.tsx";
import type { Customer } from "../types.ts";

const SAMPLE_BILL = "sample";

export function InvoiceCheck({ customer }: { customer: Customer }) {
  const answers = accountAnswers(customer);
  const { bills } = useBills(customer.id);
  const { reviewFor, setReview } = useInvoiceReview(customer.id);
  const [selected, setSelected] = useState(SAMPLE_BILL);
  const uploaded = bills.find((bill) => bill.id === selected);
  const showingSample = selected === SAMPLE_BILL || !uploaded;

  return (
    <section className="block" id="invoice-check">
      <h2>Invoice check</h2>
      <p className="section-intro">
        {LATEST_MONTH} checked against the sample agreement. A logistics review can leave an objection
        open or mark the line accepted. This screen does not pay the invoice.
      </p>
      {bills.length > 0 ? (
        <label className="bill-field invoice-picker">
          <span>Bill</span>
          <select value={showingSample ? SAMPLE_BILL : selected} onChange={(event) => setSelected(event.target.value)}>
            <option value={SAMPLE_BILL}>Sample agreement invoice</option>
            {bills.map((bill) => (
              <option key={bill.id} value={bill.id}>
                {bill.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {showingSample ? (
        <SampleLines
          lines={answers.agreementLines}
          reviewFor={reviewFor}
          setReview={setReview}
        />
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
  const impact = lines.reduce((sum, line) => sum + line.difference, 0);
  return (
    <>
      <p className="section-intro">
        Lines where the invoice differs from the signed rate. The kroner impact is {formatKr(impact)}. Raise
        the open lines with the carrier named on the row.
      </p>
      <div className="table-wrap">
        <table className="invoice-lines">
          <caption className="sr-only">Sample agreement check</caption>
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Carrier</th>
              <th scope="col" className="num">
                Invoiced
              </th>
              <th scope="col" className="num">
                Agreed
              </th>
              <th scope="col" className="num">
                Difference
              </th>
              <th scope="col">Review</th>
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
                    <p className="review-label">{state === "open" ? "Open objection" : "Accepted"}</p>
                    <p className="review-hint">Raise with {line.carrier}</p>
                    <button
                      type="button"
                      className="bill-remove"
                      onClick={() => setReview(`line:${line.id}`, state === "open" ? "accepted" : "open")}
                    >
                      {state === "open" ? "Mark accepted" : "Reopen objection"}
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
  return (
    <div className="uploaded-check">
      <p className="section-intro">
        {label} was read as a total of {formatKr(amount)}. The carrier profiles describe how an invoice is
        shaped. They do not read lines from this file, so there is no line deviation to show. The review
        below is for the total only.
      </p>
      <p className="review-label">{state === "open" ? "Open objection" : "Accepted"}</p>
      <button type="button" className="bill-choice" onClick={() => onChange(state === "open" ? "accepted" : "open")}>
        {state === "open" ? "Mark accepted" : "Reopen objection"}
      </button>
    </div>
  );
}
