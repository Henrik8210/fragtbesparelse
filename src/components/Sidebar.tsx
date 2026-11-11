import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { customers } from "../data/portfolio.ts";
import { useLanguage } from "../language.tsx";
import { useSession } from "../session.tsx";

const STORAGE_KEY = "fairlane-sidebar";

function readCollapsed(): boolean {
  if (window.matchMedia("(max-width: 800px)").matches) return true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "collapsed") return true;
    if (stored === "open") return false;
  } catch {
    // Private browsing can block storage. The menu still works for this visit.
  }
  return false;
}

function remember(collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "collapsed" : "open");
  } catch {
    // The menu still works for this visit if storage is unavailable.
  }
}

function accountFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/customers\/([^/]+)/);
  const customerId = match?.[1];
  if (!customerId || !customers.some((customer) => customer.id === customerId)) return null;
  return customerId;
}

export function Sidebar() {
  const { session } = useSession();
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const signedInCustomer =
    session?.role === "customer" ? customers.find((customer) => customer.id === session.customerId) : undefined;
  const accountId = signedInCustomer?.id ?? accountFromPath(pathname);
  const base = accountId ? `/customers/${accountId}` : "";
  const home = accountId ? base : "/";

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      remember(next);
      return next;
    });
  }

  function closeOnNarrow() {
    if (!window.matchMedia("(max-width: 800px)").matches) return;
    setCollapsed(true);
  }

  const billingTo = `${base}/billing`;
  const billsTo = `${base}/billing/bills`;
  const usersTo = `${base}/users`;

  return (
    <div className={collapsed ? "sidebar-slot is-collapsed" : "sidebar-slot"}>
      {!collapsed ? (
        <button type="button" className="sidebar-backdrop" aria-label={t("nav.close")} onClick={closeOnNarrow} />
      ) : null}
      <aside id="sidebar" className="sidebar">
        <div className="sidebar-head">
          <NavLink to={home} end className="brand sidebar-brand" aria-label={t("nav.home")} onClick={closeOnNarrow}>
            <span className="brand-name">Fragtblik</span>
          </NavLink>
          <button
            type="button"
            className="sidebar-toggle"
            aria-expanded={!collapsed}
            aria-controls="sidebar"
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            onClick={toggle}
          >
            <CollapseIcon />
            <span className="toggle-label" aria-hidden="true">
              {collapsed ? t("nav.menu") : t("nav.hide")}
            </span>
          </button>
        </div>
        <nav id="sidebar-nav" className="sidebar-nav" aria-label={t("nav.main")}>
          <p className="sidebar-label">{t("nav.menu")}</p>
          <ul className="sidebar-list">
            <li>
              <NavLink to={home} end className={linkClass} onClick={closeOnNarrow}>
                <span className="nav-glyph" aria-hidden="true">
                  <GridIcon />
                </span>
                <span className="nav-copy">
                  <span className="nav-label">{t("nav.overview")}</span>
                  <span className="nav-meta">{t("nav.overviewMeta")}</span>
                </span>
              </NavLink>
            </li>
            {accountId ? (
              <>
                <li>
                  <NavLink to={`${base}/check`} end className={linkClass} onClick={closeOnNarrow}>
                    <span className="nav-copy">
                      <span className="nav-label">{t("nav.check")}</span>
                      <span className="nav-meta">{t("nav.checkMeta")}</span>
                    </span>
                  </NavLink>
                </li>
                <li>
                  <NavLink to={`${base}/history`} end className={linkClass} onClick={closeOnNarrow}>
                    <span className="nav-copy">
                      <span className="nav-label">{t("nav.history")}</span>
                      <span className="nav-meta">{t("nav.historyMeta")}</span>
                    </span>
                  </NavLink>
                </li>
                <li>
                  <NavLink to={`${base}/tender`} end className={linkClass} onClick={closeOnNarrow}>
                    <span className="nav-copy">
                      <span className="nav-label">{t("nav.tender")}</span>
                      <span className="nav-meta">{t("nav.tenderMeta")}</span>
                    </span>
                  </NavLink>
                </li>
              </>
            ) : null}
            <li className="nav-group">
              <NavLink to={billingTo} end className={linkClass} onClick={closeOnNarrow}>
                <span className="nav-glyph" aria-hidden="true">
                  <BillingIcon />
                </span>
                <span className="nav-copy">
                  <span className="nav-label">{t("nav.billing")}</span>
                  <span className="nav-meta">{t("nav.billingMeta")}</span>
                </span>
              </NavLink>
              <ul className="nav-sub">
                <li>
                  <NavLink to={billsTo} end className={linkClass} onClick={closeOnNarrow}>
                    <span className="nav-glyph" aria-hidden="true">
                      <BillsIcon />
                    </span>
                    <span className="nav-copy">
                      <span className="nav-label">{t("nav.bills")}</span>
                      <span className="nav-meta">{t("nav.billsMeta")}</span>
                    </span>
                  </NavLink>
                </li>
              </ul>
            </li>
            <li>
              <NavLink to={usersTo} end className={linkClass} onClick={closeOnNarrow}>
                <span className="nav-glyph" aria-hidden="true">
                  <UsersIcon />
                </span>
                <span className="nav-copy">
                  <span className="nav-label">{t("nav.users")}</span>
                  <span className="nav-meta">{t("nav.usersMeta")}</span>
                </span>
              </NavLink>
            </li>
          </ul>
        </nav>
        <div className="sidebar-foot">
          <NavLink
            to={`${base}/settings`}
            end
            className={linkClass}
            aria-label={t("nav.settings")}
            onClick={closeOnNarrow}
          >
            <CogIcon />
            <span className="nav-label">{t("nav.settings")}</span>
          </NavLink>
        </div>
      </aside>
    </div>
  );
}

function linkClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link is-active" : "nav-link";
}

function CollapseIcon() {
  return (
    <svg className="toggle-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M11.25 4.25 6.5 9l4.75 4.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1.2" fill="currentColor" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1.2" fill="currentColor" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function BillingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="1.5" width="10" height="13" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function BillsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.2 2.2h6.2l3.4 3.4v8.2H3.2V2.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9.2 2.4v3.2h3.2M5.2 8h5.6M5.2 10.6h3.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="6" cy="5.2" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.8 12.2c.5-1.8 1.7-2.7 3.2-2.7s2.7.9 3.2 2.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="11" cy="5.6" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.6 9.6c1.2.2 2.1.9 2.6 2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CogIcon() {
  return (
    <svg className="cog" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
