import { decimalText, type AgreementSurcharge, type AgreementTerms } from "./agreementFormat.ts";

const price = (value: number | null, currency: string) => value === null ? "Skal aftales" : `${decimalText(value)} ${currency || "DKK"}`;

function surchargeValue(item: AgreementSurcharge): string {
  if (item.kind === "agreed" || item.value === null) return "Skal aftales";
  return item.kind === "percent" ? `${decimalText(item.value, "percent")} %` : `${decimalText(item.value)} kr.${item.unit ? ` ${item.unit}` : ""}`;
}

/** Read-only view of a format 2 agreement's items, grids, surcharges and conditions. */
export function AgreementTermsView({ terms }: { terms: AgreementTerms }) {
  return (
    <div className="agreement-terms">
      {terms.items.length ? (
        <details className="terms-grid" open={terms.items.length <= 12}>
          <summary><strong>Priser</strong> <small>{terms.items.length}</small></summary>
          <div className="grid-scroll">
            <table className="terms-table">
              <thead><tr><th>Kategori</th><th>Beskrivelse</th><th>Enhed</th><th>Pris</th></tr></thead>
              <tbody>
                {terms.items.map((item, index) => (
                  <tr key={index}>
                    <td>{item.category}</td>
                    <td>{item.description}{item.note ? <small className="terms-note"> {item.note}</small> : null}</td>
                    <td>{item.unit}</td>
                    <td>{price(item.price, item.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      {terms.grids.map((grid, index) => (
        <details key={index} className="terms-grid">
          <summary><strong>{grid.name}</strong> <small>{[grid.category, grid.unit, grid.currency, grid.note].filter(Boolean).join(" · ")}</small></summary>
          <div className="grid-scroll">
            <table className="terms-table">
              <thead>
                <tr>
                  <th>{grid.rowLabel}</th>
                  {grid.columns.map((column, at) => <th key={at}>{column.label}{column.detail ? <small className="terms-note"> {column.detail}</small> : null}</th>)}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row, at) => (
                  <tr key={at}><td>{row.label}</td>{row.cells.map((cell, column) => <td key={column}>{decimalText(cell)}</td>)}</tr>
                ))}
                {grid.minimum.length ? <tr><td>Minimum</td>{grid.minimum.map((cell, column) => <td key={column}>{decimalText(cell)}</td>)}</tr> : null}
                {grid.maximum.length ? <tr><td>Maksimum</td>{grid.maximum.map((cell, column) => <td key={column}>{decimalText(cell)}</td>)}</tr> : null}
              </tbody>
            </table>
          </div>
        </details>
      ))}
      {terms.surcharges.length ? (
        <ul className="terms-list">
          {terms.surcharges.map((item, index) => (
            <li key={index}><strong>{item.label}</strong> {surchargeValue(item)}{item.scope ? ` · ${item.scope}` : ""}{item.note ? ` · ${item.note}` : ""}</li>
          ))}
        </ul>
      ) : null}
      {terms.conditions.length ? (
        <details className="terms-grid">
          <summary><strong>Betingelser</strong> <small>{terms.conditions.length}</small></summary>
          <ul className="terms-list">{terms.conditions.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
