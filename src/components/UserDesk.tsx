import { useId, useState, type FormEvent } from "react";
import { customers } from "../data/portfolio.ts";
import { ACCOUNT_ROLES, ROLE_ACCESS, usePeople, type AccountRole } from "../people.tsx";
import type { Customer } from "../types.ts";

type Mode = "closed" | "choose" | "account" | "admin";

const SEATS = ACCOUNT_ROLES.map((role) => ({ role, access: ROLE_ACCESS[role] }));

export function UserDesk({
  customer,
  role,
}: {
  customer: Customer | null;
  role: "admin" | "customer";
}) {
  const { account, admins, addAccountUser, addAdmin, removeAccountUser, removeAdmin } = usePeople();
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

  function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "");
    const seat = String(data.get("role") ?? "");
    const customerId = isAdmin ? String(data.get("customerId") ?? "") : (customer?.id ?? "");
    if (!isAccountRole(seat)) {
      setError("Choose a role.");
      return;
    }
    const problem = addAccountUser({ name, role: seat, customerId });
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setMode("closed");
  }

  function addAdminUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = addAdmin(String(new FormData(event.currentTarget).get("name") ?? ""));
    if (problem) {
      setError(problem);
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
      <h1>Users</h1>
      {customer ? <p className="meta">{customer.name}</p> : <p className="meta">Fairlane admin</p>}
      <p className="lede">
        {isAdmin
          ? "Add a user on a customer account, or add an admin. An admin can sign in from Log in and open every account. People you add stay in this browser."
          : "Add a user on this account. Sample seats stay listed below. People you add stay in this browser."}
      </p>

      {hasAdded ? (
        <div className="bill-toolbar">
          <h2>People you added</h2>
          <button
            type="button"
            className="add-plus is-small"
            aria-expanded={mode !== "closed"}
            aria-controls={panelId}
            onClick={toggle}
          >
            <span aria-hidden="true">+</span>
            <span className="sr-only">Add a user</span>
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
            <span className="sr-only">Add a user</span>
          </button>
          <p>{isAdmin ? "Add a user on a customer account, or add an admin." : "Add the first user on this account."}</p>
        </div>
      )}

      {mode !== "closed" ? (
        <div className="bill-panel" id={panelId}>
          {mode === "choose" ? (
            <div className="bill-choices">
              <button type="button" className="bill-choice" onClick={() => setMode("account")}>
                User on a customer account
              </button>
              <button type="button" className="bill-choice" onClick={() => setMode("admin")}>
                Admin user
              </button>
            </div>
          ) : null}
          {mode === "account" ? (
            <form className="bill-form" onSubmit={addAccount}>
              {isAdmin && !customer ? (
                <label className="bill-field">
                  <span>Customer account</span>
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
                <span>Name</span>
                <input name="name" type="text" maxLength={80} required placeholder="Name" />
              </label>
              <label className="bill-field">
                <span>Role</span>
                <select name="role" defaultValue="Operations">
                  {SEATS.map((seat) => (
                    <option key={seat.role} value={seat.role}>
                      {seat.role}
                    </option>
                  ))}
                </select>
              </label>
              <div className="bill-actions">
                <button type="submit" className="bill-choice">
                  Add user
                </button>
                {isAdmin ? (
                  <button type="button" className="bill-back" onClick={() => setMode("choose")}>
                    Back
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
          {mode === "admin" ? (
            <form className="bill-form" onSubmit={addAdminUser}>
              <label className="bill-field">
                <span>Name</span>
                <input name="name" type="text" maxLength={80} required placeholder="Name" />
              </label>
              <p className="hint">This person signs in as an admin and can open every account.</p>
              <div className="bill-actions">
                <button type="submit" className="bill-choice">
                  Add admin
                </button>
                <button type="button" className="bill-back" onClick={() => setMode("choose")}>
                  Back
                </button>
              </div>
            </form>
          ) : null}
          {error ? <p className="bill-errors">{error}</p> : null}
        </div>
      ) : null}

      {grouped.map((group) => (
        <section key={group.customer.id} className="block">
          <h2>{isAdmin ? group.customer.name : "On this account"}</h2>
          <ul className="seat-list">
            {group.people.map((person) => (
              <li key={person.id}>
                <span>
                  <span className="seat-role">{person.name}</span>
                  <span className="seat-person-role">
                    {person.role}
                    <span className="seat-access"> · {ROLE_ACCESS[person.role]}</span>
                  </span>
                </span>
                <button type="button" className="bill-remove" onClick={() => removeAccountUser(person.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {isAdmin && admins.length > 0 ? (
        <section className="block">
          <h2>Admins</h2>
          <ul className="seat-list">
            {admins.map((person) => (
              <li key={person.id}>
                <span>
                  <span className="seat-role">{person.name}</span>
                  <span className="seat-person-role">Admin · every customer account</span>
                </span>
                <button type="button" className="bill-remove" onClick={() => removeAdmin(person.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {customer ? (
        <section className="block">
          <h2>Sample seats</h2>
          <ul className="seat-list">
            {SEATS.map((seat) => (
              <li key={seat.role}>
                <span className="seat-role">{seat.role}</span>
                <span className="seat-access">{seat.access}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function isAccountRole(value: string): value is AccountRole {
  return ACCOUNT_ROLES.some((role) => role === value);
}
