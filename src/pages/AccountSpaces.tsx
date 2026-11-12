import { useEffect, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { withBillSpend } from "../bills/spend.ts";
import { useBills } from "../bills.tsx";
import { BillDesk } from "../components/BillDesk.tsx";
import { UserDesk } from "../components/UserDesk.tsx";
import { LATEST_MONTH, MONTHS, currentMonthTrack, customers } from "../data/portfolio.ts";
import { formatKr } from "../format.ts";
import { useLanguage } from "../language.tsx";
import { useSession } from "../session.tsx";
import type { Customer } from "../types.ts";
import { NotFound } from "./NotFound.tsx";

export function BillingPage() {
  return (
    <Space name="billing">
      {(customer, role) =>
        customer ? <BillingDetail customer={customer} /> : <ChooseAccount role={role} space="billing" />
      }
    </Space>
  );
}

export function BillsPage() {
  return (
    <Space name="bills" path="billing/bills">
      {(customer, role) =>
        customer ? <BillDesk customer={customer} /> : <ChooseAccount role={role} space="bills" />
      }
    </Space>
  );
}

export function UsersPage() {
  return (
    <Space name="users">
      {(customer, role) => (role ? <UserDesk customer={customer} role={role} /> : null)}
    </Space>
  );
}

export function SettingsPage() {
  return (
    <Space name="settings">
      {(customer, role) => <SettingsDetail customer={customer} role={role} />}
    </Space>
  );
}

function Space({
  name,
  path,
  children,
}: {
  name: "billing" | "bills" | "users" | "settings";
  path?: string;
  children: (customer: Customer | null, role: "admin" | "customer" | null) => ReactNode;
}) {
  const { customerId } = useParams();
  const { session, ready } = useSession();
  const { t } = useLanguage();
  const customer = customers.find((item) => item.id === customerId);
  const title =
    name === "billing" ? t("billing.title") : name === "bills" ? t("bills.title") : name === "users" ? t("users.title") : t("settings.title");

  useEffect(() => {
    document.title = `${title} · Fragtblik`;
  }, [title]);

  if (!ready) return null;
  if (session?.role === "customer" && session.customerId && !customerId) {
    return <Navigate to={`/customers/${session.customerId}/${path ?? name}`} replace />;
  }
  if (customerId && !customer) {
    return <NotFound title={t("notFound.noCompany")} body={t("notFound.noCompanyBody")} />;
  }
  if (customer && session?.role === "customer" && session.customerId !== customer.id) {
    return <NotFound title={t("notFound.notYours")} body={t("notFound.notYoursPages")} />;
  }
  const role = session?.role === "customer" ? "customer" : "admin";
  return <div className="page">{children(customer ?? null, role)}</div>;
}

function BillingDetail({ customer }: { customer: Customer }) {
  const { total } = useBills(customer.id);
  const { t, phrase } = useLanguage();
  const month = phrase(`month.${MONTHS[MONTHS.length - 1].id}`, LATEST_MONTH);
  const track = withBillSpend(currentMonthTrack(customer), total);
  const difference = track.spent - track.budget;
  return (
    <>
      <h1>{t("billing.title")}</h1>
      <p className="meta">{customer.name}</p>
      <p className="lede">
        {t("billing.lede", {
          month,
          bills: total > 0 ? t("billing.bills", { amount: formatKr(total) }) : "",
        })}
      </p>
      <p className="wayfinding">
        <Link className="text-link" to={`/customers/${customer.id}/billing/bills`}>
          {t("bills.title")}
        </Link>{" "}
        {t("billing.wayfinding")}
      </p>
      <div className="table-wrap">
        <table className="months">
          <caption className="sr-only">
            {t("billing.caption", { name: customer.name, month })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("common.line")}</th>
              <th scope="col" className="num">
                {t("common.amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t("billing.freight")}</th>
              <td className="num">{formatKr(track.spent)}</td>
            </tr>
            {total > 0 ? (
              <tr>
                <th scope="row">{t("billing.fromBills")}</th>
                <td className="num">{formatKr(total)}</td>
              </tr>
            ) : null}
            <tr>
              <th scope="row">{t("common.budget")}</th>
              <td className="num">{formatKr(track.budget)}</td>
            </tr>
            <tr>
              <th scope="row">{difference >= 0 ? t("billing.over") : t("billing.under")}</th>
              <td className="num">{formatKr(Math.abs(difference))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function LanguageSetting() {
  const { lang, setLang, t } = useLanguage();
  return (
    <fieldset className="language-setting">
      <legend>{t("settings.language")}</legend>
      <p className="section-intro">{t("settings.languageNote")}</p>
      <div className="language-switch" role="group" aria-label={t("settings.language")}>
        <button type="button" aria-pressed={lang === "da"} onClick={() => setLang("da")}>
          {t("lang.da")}
        </button>
        <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
          {t("lang.en")}
        </button>
      </div>
    </fieldset>
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
  const { t } = useLanguage();
  const signedIn =
    role === "admin"
      ? session?.role === "admin"
        ? (session.name ?? t("account.admin"))
        : t("account.admin")
      : t("settings.companyOnly");
  return (
    <>
      <h1>{t("settings.title")}</h1>
      <p className="meta">{customer ? customer.name : t("account.admin")}</p>
      <LanguageSetting />
      <dl className="settings-list">
        <div>
          <dt>{t("settings.account")}</dt>
          <dd>{customer ? customer.name : t("settings.noAccount")}</dd>
        </div>
        <div>
          <dt>{t("settings.signedIn")}</dt>
          <dd>{signedIn}</dd>
        </div>
        <div>
          <dt>{t("settings.data")}</dt>
          <dd>{t("settings.dataValue")}</dd>
        </div>
      </dl>
    </>
  );
}

function ChooseAccount({ role, space }: { role: "admin" | "customer" | null; space: "billing" | "bills" | "users" }) {
  const { t } = useLanguage();
  const title = space === "billing" ? t("billing.title") : space === "bills" ? t("bills.title") : t("users.title");
  return (
    <>
      <h1>{title}</h1>
      <p className="lede">{role === "admin" ? t("billing.choose", { space: title }) : t("gate.signIn")}</p>
    </>
  );
}
