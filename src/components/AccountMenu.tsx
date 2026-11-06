import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { customers } from "../data/portfolio.ts";
import { usePeople } from "../people.tsx";
import { useSession, type Session } from "../session.tsx";

function initials(name: string): string {
  const words = name
    .replace(/[^A-Za-zÆØÅæøå0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function AccountMenu() {
  const { session, signIn, signOut } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const signedInCustomer =
    session?.role === "customer" ? customers.find((customer) => customer.id === session.customerId) : undefined;

  function close() {
    setOpen(false);
  }

  function choose(next: Session, path: string) {
    signIn(next);
    navigate(path);
    close();
  }

  function logOut() {
    signOut();
    navigate("/");
    close();
  }

  const adminName = session?.role === "admin" ? (session.name ?? "Admin") : "";
  const label = session?.role === "admin" ? adminName : (signedInCustomer?.name ?? "Log in");
  const mark = session?.role === "admin" ? initials(adminName) || "A" : signedInCustomer ? initials(signedInCustomer.name) : "";

  return (
    <div className="account" onKeyDown={(event) => {
      if (event.key === "Escape") close();
    }}>
      <button
        type="button"
        className={open ? "account-button is-open" : "account-button"}
        aria-expanded={open}
        aria-controls="account-panel"
        onClick={() => setOpen((current) => !current)}
      >
        {mark ? (
          <span className="account-avatar" aria-hidden="true">
            {mark}
          </span>
        ) : null}
        <span className="account-name">{label}</span>
      </button>
      {open ? (
        <>
          <button type="button" className="account-backdrop" aria-label="Close account menu" onClick={close} />
          <div id="account-panel" className="account-panel" role="region" aria-label="Account">
            {!session ? <SignedOutChoices onChoose={choose} /> : null}
            {session?.role === "admin" ? (
              <AdminChoices name={session.name} onNavigate={close} onLogOut={logOut} />
            ) : null}
            {session?.role === "customer" && signedInCustomer ? (
              <CustomerChoices name={signedInCustomer.name} onLogOut={logOut} />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function SignedOutChoices({ onChoose }: { onChoose: (session: Session, path: string) => void }) {
  const { admins } = usePeople();
  return (
    <>
      <p className="account-kicker">Sample sign-in</p>
      <p className="account-note">
        No password. A company sees only its own savings. Admin opens every account.
      </p>
      <button type="button" className="account-choice" onClick={() => onChoose({ role: "admin" }, "/")}>
        <span className="account-avatar" aria-hidden="true">
          A
        </span>
        <span>
          <span className="account-choice-name">Fairlane admin</span>
          <span className="account-choice-meta">All customer accounts</span>
        </span>
      </button>
      {admins.map((admin) => (
        <button
          key={admin.id}
          type="button"
          className="account-choice"
          onClick={() => onChoose({ role: "admin", name: admin.name }, "/")}
        >
          <span className="account-avatar" aria-hidden="true">
            {initials(admin.name)}
          </span>
          <span>
            <span className="account-choice-name">{admin.name}</span>
            <span className="account-choice-meta">Admin · every account</span>
          </span>
        </button>
      ))}
      <p className="account-kicker">Customer accounts</p>
      <ul className="account-list">
        {customers.map((customer) => (
          <li key={customer.id}>
            <button
              type="button"
              className="account-choice"
              onClick={() => onChoose({ role: "customer", customerId: customer.id }, `/customers/${customer.id}`)}
            >
              <span className="account-avatar" aria-hidden="true">
                {initials(customer.name)}
              </span>
              <span>
                <span className="account-choice-name">{customer.name}</span>
                <span className="account-choice-meta">
                  {customer.industry} · only this account
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function AdminChoices({
  name,
  onNavigate,
  onLogOut,
}: {
  name?: string;
  onNavigate: () => void;
  onLogOut: () => void;
}) {
  return (
    <>
      <p className="account-kicker">{name ? `Signed in as ${name}` : "Signed in as admin"}</p>
      <p className="account-note">Open a customer dashboard. Sample data only.</p>
      <Link className="account-choice" to="/" onClick={onNavigate}>
        <span className="account-avatar" aria-hidden="true">
          All
        </span>
        <span>
          <span className="account-choice-name">All accounts</span>
          <span className="account-choice-meta">Admin overview</span>
        </span>
      </Link>
      <ul className="account-list">
        {customers.map((customer) => (
          <li key={customer.id}>
            <Link className="account-choice" to={`/customers/${customer.id}`} onClick={onNavigate}>
              <span className="account-avatar" aria-hidden="true">
                {initials(customer.name)}
              </span>
              <span>
                <span className="account-choice-name">{customer.name}</span>
                <span className="account-choice-meta">{customer.place}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" className="account-logout" onClick={onLogOut}>
        Log out
      </button>
    </>
  );
}

function CustomerChoices({ name, onLogOut }: { name: string; onLogOut: () => void }) {
  return (
    <>
      <p className="account-kicker">Your account</p>
      <p className="account-note">{name} can see only its own sample savings.</p>
      <button type="button" className="account-logout" onClick={onLogOut}>
        Log out
      </button>
    </>
  );
}
