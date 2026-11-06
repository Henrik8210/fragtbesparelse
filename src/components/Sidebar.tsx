import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { customers } from "../data/portfolio.ts";
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
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const signedInCustomer =
    session?.role === "customer" ? customers.find((customer) => customer.id === session.customerId) : undefined;
  const accountId = signedInCustomer?.id ?? accountFromPath(pathname);
  const base = accountId ? `/customers/${accountId}` : "";
  const home = accountId ? base : "/";
  const tag =
    session?.role === "admin" ? "Admin" : signedInCustomer ? signedInCustomer.name : "Sign in to continue";

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

  const items = [
    { to: home, label: "Overview", meta: "Dashboard", icon: <GridIcon /> },
    { to: `${base}/billing`, label: "Billing", meta: "Spend and budget", icon: <BillingIcon /> },
    { to: `${base}/users`, label: "Users", meta: "People on the account", icon: <UsersIcon /> },
  ];

  return (
    <div className={collapsed ? "sidebar-slot is-collapsed" : "sidebar-slot"}>
      {!collapsed ? (
        <button type="button" className="sidebar-backdrop" aria-label="Close menu" onClick={closeOnNarrow} />
      ) : null}
      <aside id="sidebar" className="sidebar">
        <div className="sidebar-head">
          <NavLink to={home} end className="brand sidebar-brand" aria-label="Fairlane home" onClick={closeOnNarrow}>
            <span className="brand-mark" aria-hidden="true">
              F
            </span>
            <span className="brand-text">
              <span className="brand-name">Fairlane</span>
              <span className="brand-tag">{tag}</span>
            </span>
          </NavLink>
          <button
            type="button"
            className="sidebar-toggle"
            aria-expanded={!collapsed}
            aria-controls="sidebar"
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            onClick={toggle}
          >
            <CollapseIcon />
            <span className="toggle-label" aria-hidden="true">
              {collapsed ? "Menu" : "Hide"}
            </span>
          </button>
        </div>
        <nav id="sidebar-nav" className="sidebar-nav" aria-label="Main">
          <p className="sidebar-label">Menu</p>
          <ul className="sidebar-list">
            {items.map((item) => (
              <li key={item.label}>
                <NavLink to={item.to} end className={linkClass} onClick={closeOnNarrow}>
                  <span className="nav-glyph" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="nav-copy">
                    <span className="nav-label">{item.label}</span>
                    <span className="nav-meta">{item.meta}</span>
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          <NavLink
            to={`${base}/settings`}
            end
            className={linkClass}
            aria-label="Settings"
            onClick={closeOnNarrow}
          >
            <CogIcon />
            <span className="nav-label">Settings</span>
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
