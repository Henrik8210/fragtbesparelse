import type { ReactNode } from "react";
import { useLanguage } from "../language.tsx";
import { AccountMenu } from "./AccountMenu.tsx";
import { Sidebar } from "./Sidebar.tsx";

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="app">
      <div className="workspace">
        <Sidebar />
        <div className="frame">
          <div className="topbar">
            <AccountMenu />
          </div>
          <main>{children}</main>
          <footer className="foot">{t("footer")}</footer>
        </div>
      </div>
    </div>
  );
}
