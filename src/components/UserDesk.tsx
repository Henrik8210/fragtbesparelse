import { useId, useState, type FormEvent } from "react";
import { customers } from "../data/portfolio.ts";
import { useLanguage } from "../language.tsx";
import type { MessageKey } from "../i18n/messages.ts";
import { ACCOUNT_ROLES, usePeople, type AccountRole } from "../people.tsx";
import type { Customer } from "../types.ts";

type Mode = "closed" | "choose" | "account" | "admin";

const SEATS = ACCOUNT_ROLES;

export function UserDesk({
  customer,
  role,
}: {
  customer: Customer | null;
  role: "admin" | "customer";
}) {
  const { account, admins, addAccountUser, addAdmin, removeAccountUser, removeAdmin } = usePeople();
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>("closed");
  const [error, setError] = useState("");
  const panelId = useId();
  const isAdmin = role === "admin";
  const visibleAccount = isAdmin ? account : account.filter((person) => person.customerId === customer?.id);
  const hasAdded = visibleAccount.length > 0 || (isAdmin && admins.length > 0);

  function toggle() {
    setError("");
    if (mode !== "closed") {
      setMode("closed");
      return;
    }
    setMode(isAdmin ? "choose" : "account");
  }

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "");
    const username = String(data.get("username") ?? "");
    const password = String(data.get("password") ?? "");
    const seat = String(data.get("role") ?? "");
    const customerId = isAdmin ? String(data.get("customerId") ?? "") : (customer?.id ?? "");
    if (!isAccountRole(seat)) {
      setError(t("users.needRole"));
      return;
    }
    const problem = await addAccountUser({ name, username, password, role: seat, customerId });
    if (problem) {
      setError(problemText(problem, t));
      return;
    }
    setError("");
    setMode("closed");
  }

  async function addAdminUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const problem = await addAdmin({
      name: String(data.get("name") ?? ""),
      username: String(data.get("username") ?? ""),
      password: String(data.get("password") ?? ""),
    });
    if (problem) {
      setError(problemText(problem, t));
      return;
    }
    setError("");
    setMode("closed");
  }

  const grouped = customers
    .map((item) => ({ customer: item, people: visibleAccount.filter((person) => person.customerId === item.id) }))
    .filter((group) => group.people.length > 0);

  return (
    <>
      <h1>{t("users.title")}</h1>
      {customer ? <p className="meta">{customer.name}</p> : <p className="meta">{t("account.admin")}</p>}
      <p className="lede">{isAdmin ? t("users.adminLede") : t("users.customerLede")}</p>

      {hasAdded ? (
        <div className="bill-toolbar">
          <h2>{t("users.added")}</h2>
          <button
            type="button"
            className="add-plus is-small"
            aria-expanded={mode !== "closed"}
            aria-controls={panelId}
            onClick={toggle}
          >
            <span aria-hidden="true">+</span>
            <span className="sr-only">{t("users.add")}</span>
          </button>
        </div>
      ) : (
        <div className="bill-empty">
          <button
            type="button"
            className="add-plus"
            aria-expanded={mode !== "closed"}
            aria-controls={panelId}
            onClick={toggle}
          >
            <span aria-hidden="true">+</span>
            <span className="sr-only">{t("users.add")}</span>
          </button>
          <p>{isAdmin ? t("users.emptyAdmin") : t("users.emptyCustomer")}</p>
        </div>
      )}

      {mode !== "closed" ? (
        <div className="bill-panel" id={panelId}>
          {mode === "choose" ? (
            <div className="bill-choices">
              <button type="button" className="bill-choice" onClick={() => setMode("account")}>
                {t("users.onCustomer")}
              </button>
              <button type="button" className="bill-choice" onClick={() => setMode("admin")}>
                {t("users.adminUser")}
              </button>
            </div>
          ) : null}
          {mode === "account" ? (
            <form className="bill-form" onSubmit={(event) => void addAccount(event)}>
              {isAdmin && !customer ? (
                <label className="bill-field">
                  <span>{t("users.customerAccount")}</span>
                  <select name="customerId" defaultValue={customers[0]?.id}>
                    {customers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="bill-field">
                <span>{t("common.name")}</span>
                <input name="name" type="text" maxLength={80} required placeholder={t("common.name")} />
              </label>
              <label className="bill-field">
                <span>{t("users.username")}</span>
                <input name="username" type="text" maxLength={40} required autoComplete="off" />
              </label>
              <label className="bill-field">
                <span>{t("users.password")}</span>
                <input name="password" type="text" maxLength={80} required autoComplete="new-password" />
              </label>
              <label className="bill-field">
                <span>{t("common.role")}</span>
                <select name="role" defaultValue="Operations">
                  {SEATS.map((seat) => (
                    <option key={seat} value={seat}>
                      {roleLabel(seat, t)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="bill-actions">
                <button type="submit" className="bill-choice">
                  {t("users.addUser")}
                </button>
                {isAdmin ? (
                  <button type="button" className="bill-back" onClick={() => setMode("choose")}>
                    {t("common.back")}
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
          {mode === "admin" ? (
            <form className="bill-form" onSubmit={(event) => void addAdminUser(event)}>
              <label className="bill-field">
                <span>{t("common.name")}</span>
                <input name="name" type="text" maxLength={80} required placeholder={t("common.name")} />
              </label>
              <label className="bill-field">
                <span>{t("users.username")}</span>
                <input name="username" type="text" maxLength={40} required autoComplete="off" />
              </label>
              <label className="bill-field">
                <span>{t("users.password")}</span>
                <input name="password" type="text" maxLength={80} required autoComplete="new-password" />
              </label>
              <p className="hint">{t("users.adminHint")}</p>
              <div className="bill-actions">
                <button type="submit" className="bill-choice">
                  {t("users.addAdmin")}
                </button>
                <button type="button" className="bill-back" onClick={() => setMode("choose")}>
                  {t("common.back")}
                </button>
              </div>
            </form>
          ) : null}
          {error ? <p className="bill-errors">{error}</p> : null}
        </div>
      ) : null}

      {grouped.map((group) => (
        <section key={group.customer.id} className="block">
          <h2>{isAdmin ? group.customer.name : t("users.onAccount")}</h2>
          <ul className="seat-list">
            {group.people.map((person) => (
              <li key={person.id}>
                <span>
                  <span className="seat-role">{person.name}</span>
                  <span className="seat-person-role">
                    {person.username} · {roleLabel(person.role, t)}
                    <span className="seat-access"> · {roleAccess(person.role, t)}</span>
                  </span>
                </span>
                {person.sample ? null : (
                  <button type="button" className="bill-remove" onClick={() => removeAccountUser(person.id)}>
                    {t("common.remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {isAdmin && admins.length > 0 ? (
        <section className="block">
          <h2>{t("users.admins")}</h2>
          <ul className="seat-list">
            {admins.map((person) => (
              <li key={person.id}>
                <span>
                  <span className="seat-role">{person.name}</span>
                  <span className="seat-person-role">{t("users.adminAccess")}</span>
                </span>
                {person.sample ? null : (
                  <button type="button" className="bill-remove" onClick={() => removeAdmin(person.id)}>
                    {t("common.remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {customer ? (
        <section className="block">
          <h2>{t("users.sampleSeats")}</h2>
          <ul className="seat-list">
            {SEATS.map((seat) => (
              <li key={seat}>
                <span className="seat-role">{roleLabel(seat, t)}</span>
                <span className="seat-access">{roleAccess(seat, t)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function problemText(problem: string, t: (key: MessageKey) => string): string {
  if (problem === "customer") return t("users.needCustomer");
  if (problem === "username") return t("users.needUsername");
  if (problem === "password") return t("users.needPassword");
  if (problem === "taken") return t("users.taken");
  return t("users.needName");
}

function isAccountRole(value: string): value is AccountRole {
  return ACCOUNT_ROLES.some((role) => role === value);
}

function roleLabel(role: AccountRole, t: (key: MessageKey) => string): string {
  if (role === "Owner") return t("role.Owner");
  if (role === "Billing") return t("role.Billing");
  return t("role.Operations");
}

function roleAccess(role: AccountRole, t: (key: MessageKey) => string): string {
  if (role === "Owner") return t("role.Owner.access");
  if (role === "Billing") return t("role.Billing.access");
  return t("role.Operations.access");
}
