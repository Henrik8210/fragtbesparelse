import type { ReactNode } from "react";
import { AccountMenu } from "./AccountMenu.tsx";
import { Sidebar } from "./Sidebar.tsx";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <div className="workspace">
        <Sidebar />
        <div className="frame">
          <div className="topbar">
            <AccountMenu />
          </div>
          <main>{children}</main>
          <footer className="foot">Fairlane sample data only. Not an audit, a contract, or a carrier quote.</footer>
        </div>
      </div>
    </div>
  );
}
