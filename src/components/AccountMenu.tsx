import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { customers } from "../data/portfolio.ts";
import { useLanguage } from "../language.tsx";
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
  const { t } = useLanguage();
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

  const adminName = session?.role === "admin" ? (session.name ?? t("account.admin")) : "";
  const label = session?.role === "admin" ? adminName : (signedInCustomer?.name ?? t("account.signIn"));
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
          <button type="button" className="account-backdrop" aria-label={t("account.close")} onClick={close} />
          <div id="account-panel" className="account-panel" role="region" aria-label={t("account.region")}>
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
  const { t } = useLanguage();
  return (
    <>
      <p className="account-kicker">{t("account.sample")}</p>
      <p className="account-note">{t("account.note")}</p>
      <button type="button" className="account-choice" onClick={() => onChoose({ role: "admin" }, "/")}>
        <span className="account-avatar" aria-hidden="true">
          A
        </span>
        <span>
          <span className="account-choice-name">{t("account.admin")}</span>
          <span className="account-choice-meta">{t("account.adminMeta")}</span>
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
            <span className="account-choice-meta">{t("account.adminEvery")}</span>
          </span>
        </button>
      ))}
      <p className="account-kicker">{t("account.customers")}</p>
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
                  {customer.industry === "Ecommerce" ? t("industry.Ecommerce") : t("industry.Manufacturing")} · {t("account.onlyThis")}
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
  const { t } = useLanguage();
  return (
    <>
      <p className="account-kicker">{name ? t("account.signedInAs", { name }) : t("account.signedInAdmin")}</p>
      <p className="account-note">{t("account.openDash")}</p>
      <Link className="account-choice" to="/" onClick={onNavigate}>
        <span className="account-avatar" aria-hidden="true">
          All
        </span>
        <span>
          <span className="account-choice-name">{t("account.all")}</span>
          <span className="account-choice-meta">{t("account.allMeta")}</span>
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
        {t("account.logOut")}
      </button>
    </>
  );
}

function CustomerChoices({ name, onLogOut }: { name: string; onLogOut: () => void }) {
  const { t } = useLanguage();
  return (
    <>
      <p className="account-kicker">{t("account.your")}</p>
      <p className="account-note">{t("account.onlySavings", { name })}</p>
      <button type="button" className="account-logout" onClick={onLogOut}>
        {t("account.logOut")}
      </button>
    </>
  );
}
