import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <div className="banner" role="note">
        <strong>Fairlane sample data</strong>
        <span>These figures are invented. No real customer, invoice, or carrier quote is shown.</span>
      </div>
      <div className="frame">
        <header className="top">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              F
            </span>
            <span className="brand-text">
              <span className="brand-name">Fairlane</span>
              <span className="brand-tag">Freight paid against a benchmark</span>
            </span>
          </Link>
        </header>
        <main>{children}</main>
        <footer className="foot">Fairlane sample data only. Not an audit, a contract, or a carrier quote.</footer>
      </div>
    </div>
  );
}
