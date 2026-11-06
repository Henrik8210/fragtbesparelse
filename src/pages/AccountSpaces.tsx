import { useEffect, type ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { LATEST_MONTH, currentMonthTrack, customers } from "../data/portfolio.ts";
import { formatKr } from "../format.ts";
import { useSession } from "../session.tsx";
import type { Customer } from "../types.ts";
import { NotFound } from "./NotFound.tsx";

const SEATS = [
  { role: "Owner", access: "The whole account" },
  { role: "Billing", access: "Spend and the budget" },
  { role: "Operations", access: "Lanes and carriers" },
] as const;

export function BillingPage() {
  return (
    <Space title="Billing">
      {(customer, role) =>
        customer ? <BillingDetail customer={customer} /> : <ChooseAccount role={role} space="billing" />
      }
    </Space>
  );
}

export function UsersPage() {
  return (
    <Space title="Users">
      {(customer, role) =>
        customer ? <UsersDetail customer={customer} /> : <ChooseAccount role={role} space="users" />
      }
    </Space>
  );
}

export function SettingsPage() {
  return (
    <Space title="Settings">
      {(customer, role) => <SettingsDetail customer={customer} role={role} />}
    </Space>
  );
}

function Space({
  title,
  children,
}: {
  title: string;
  children: (customer: Customer | null, role: "admin" | "customer" | null) => ReactNode;
}) {
  const { customerId } = useParams();
  const { session } = useSession();
  const customer = customers.find((item) => item.id === customerId);

  useEffect(() => {
    document.title = `${title} · Fairlane`;
  }, [title]);

  if (session?.role === "customer" && !customerId) {
    return <Navigate to={`/customers/${session.customerId}/${title.toLowerCase()}`} replace />;
  }
  if (customerId && !customer) {
    return (
      <NotFound
        title="No sample company matches that link"
        body="Fairlane sample data includes only the fictional companies in the portfolio."
      />
    );
  }
  if (customer && !session) {
    return (
      <NotFound
        title="Sign in to open this account"
        body={`${customer.name} is a sample company. Use Log in in the upper right and choose that account, or sign in as a Fairlane admin.`}
      />
    );
  }
  if (customer && session?.role === "customer" && session.customerId !== customer.id) {
    return (
      <NotFound
        title="This account is not yours"
        body="A company sign-in shows only that company's pages. Sign in as a Fairlane admin to open every account."
      />
    );
  }
  if (!session) {
    return (
      <div className="page">
        <h1>{title}</h1>
        <p className="lede">Sign in from the upper right to open an account.</p>
      </div>
    );
  }
  return <div className="page">{children(customer ?? null, session.role)}</div>;
}

function BillingDetail({ customer }: { customer: Customer }) {
  const track = currentMonthTrack(customer);
  const difference = track.spent - track.budget;
  return (
    <>
      <h1>Billing</h1>
      <p className="meta">{customer.name}</p>
      <p className="lede">
        {LATEST_MONTH} sample statement. Spend is what the account was invoiced. The budget is the
        amount projected for the month. Nothing here can be paid, and this is not a real invoice.
      </p>
      <div className="table-wrap">
        <table className="months">
          <caption className="sr-only">
            Sample billing for {customer.name} in {LATEST_MONTH}
          </caption>
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col" className="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Freight spend</th>
              <td className="num">{formatKr(track.spent)}</td>
            </tr>
            <tr>
              <th scope="row">Budget</th>
              <td className="num">{formatKr(track.budget)}</td>
            </tr>
            <tr>
              <th scope="row">{difference >= 0 ? "Over budget" : "Under budget"}</th>
              <td className="num">{formatKr(Math.abs(difference))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function UsersDetail({ customer }: { customer: Customer }) {
  return (
    <>
      <h1>Users</h1>
      <p className="meta">{customer.name}</p>
      <p className="lede">
        Sample seats on this account. They are roles, not real people, and they cannot sign in on
        their own.
      </p>
      <ul className="seat-list">
        {SEATS.map((seat) => (
          <li key={seat.role}>
            <span className="seat-role">{seat.role}</span>
            <span className="seat-access">{seat.access}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function SettingsDetail({
  customer,
  role,
}: {
  customer: Customer | null;
  role: "admin" | "customer" | null;
}) {
  return (
    <>
      <h1>Settings</h1>
      <p className="meta">{customer ? customer.name : "Fairlane admin"}</p>
      <dl className="settings-list">
        <div>
          <dt>Account</dt>
          <dd>{customer ? customer.name : "No customer account is open"}</dd>
        </div>
        <div>
          <dt>Signed in as</dt>
          <dd>{role === "admin" ? "Fairlane admin" : "This company only"}</dd>
        </div>
        <div>
          <dt>Data</dt>
          <dd>Sample figures only. These settings do not change a live account.</dd>
        </div>
      </dl>
    </>
  );
}

function ChooseAccount({ role, space }: { role: "admin" | "customer" | null; space: string }) {
  return (
    <>
      <h1>{space === "billing" ? "Billing" : "Users"}</h1>
      <p className="lede">
        {role === "admin"
          ? `Open a customer from Log in in the upper right. ${space === "billing" ? "Billing" : "Users"} is kept on that account.`
          : "Sign in from the upper right to open an account."}
      </p>
    </>
  );
}
