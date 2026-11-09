import { useEffect, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { withBillSpend } from "../bills/spend.ts";
import { useBills } from "../bills.tsx";
import { BillDesk } from "../components/BillDesk.tsx";
import { UserDesk } from "../components/UserDesk.tsx";
import { LATEST_MONTH, currentMonthTrack, customers } from "../data/portfolio.ts";
import { formatKr } from "../format.ts";
import { useSession } from "../session.tsx";
import type { Customer } from "../types.ts";
import { NotFound } from "./NotFound.tsx";

export function BillingPage() {
  return (
    <Space title="Billing">
      {(customer, role) =>
        customer ? <BillingDetail customer={customer} /> : <ChooseAccount role={role} space="billing" />
      }
    </Space>
  );
}

export function BillsPage() {
  return (
    <Space title="Bills" path="billing/bills">
      {(customer, role) =>
        customer ? <BillDesk customer={customer} /> : <ChooseAccount role={role} space="bills" />
      }
    </Space>
  );
}

export function UsersPage() {
  return (
    <Space title="Users">
      {(customer, role) => (role ? <UserDesk customer={customer} role={role} /> : null)}
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
  path,
  children,
}: {
  title: string;
  path?: string;
  children: (customer: Customer | null, role: "admin" | "customer" | null) => ReactNode;
}) {
  const { customerId } = useParams();
  const { session } = useSession();
  const customer = customers.find((item) => item.id === customerId);

  useEffect(() => {
    document.title = `${title} · Fairlane`;
  }, [title]);

  if (session?.role === "customer" && !customerId) {
    return <Navigate to={`/customers/${session.customerId}/${path ?? title.toLowerCase()}`} replace />;
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
  const { total } = useBills(customer.id);
  const track = withBillSpend(currentMonthTrack(customer), total);
  const difference = track.spent - track.budget;
  return (
    <>
      <h1>Billing</h1>
      <p className="meta">{customer.name}</p>
      <p className="lede">
        {LATEST_MONTH} statement. Spend is the sample invoices
        {total > 0 ? ` plus ${formatKr(total)} from bills on this account` : ""}. The same total is
        on the overview. The budget is the amount projected for the month. Nothing here can be paid,
        and this is not a real invoice.
      </p>
      <p className="wayfinding">
        <Link className="text-link" to={`/customers/${customer.id}/billing/bills`}>
          Bills
        </Link>{" "}
        under this menu are included in freight spend.
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
            {total > 0 ? (
              <tr>
                <th scope="row">From bills you added</th>
                <td className="num">{formatKr(total)}</td>
              </tr>
            ) : null}
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

function SettingsDetail({
  customer,
  role,
}: {
  customer: Customer | null;
  role: "admin" | "customer" | null;
}) {
  const { session } = useSession();
  const signedIn =
    role === "admin"
      ? session?.role === "admin"
        ? (session.name ?? "Fairlane admin")
        : "Fairlane admin"
      : "This company only";
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
          <dd>{signedIn}</dd>
        </div>
        <div>
          <dt>Data</dt>
          <dd>Sample figures, plus bills and people you add on this browser.</dd>
        </div>
      </dl>
    </>
  );
}

function ChooseAccount({ role, space }: { role: "admin" | "customer" | null; space: string }) {
  return (
    <>
      <h1>{space === "billing" ? "Billing" : space === "bills" ? "Bills" : "Users"}</h1>
      <p className="lede">
        {role === "admin"
          ? `Open a customer from Log in in the upper right. ${space === "billing" ? "Billing" : space === "bills" ? "Bills" : "Users"} is kept on that account.`
          : "Sign in from the upper right to open an account."}
      </p>
    </>
  );
}
