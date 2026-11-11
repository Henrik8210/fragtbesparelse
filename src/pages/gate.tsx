import { useParams } from "react-router-dom";
import { customers } from "../data/portfolio.ts";
import { useLanguage } from "../language.tsx";
import { useSession, type Session } from "../session.tsx";
import type { Customer } from "../types.ts";

export type Gate =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "signedout"; customer: Customer }
  | { status: "forbidden"; customer: Customer }
  | { status: "ok"; customer: Customer; session: Session };

export function useCustomerGate(): Gate {
  const { customerId } = useParams();
  const { session, ready } = useSession();
  const customer = customers.find((item) => item.id === customerId);
  if (!ready) return { status: "loading" };
  if (!customer) return { status: "missing" };
  if (!session) return { status: "signedout", customer };
  if (session.role === "customer" && session.customerId !== customer.id) return { status: "forbidden", customer };
  return { status: "ok", customer, session };
}

export function GateView({ gate }: { gate: Exclude<Gate, { status: "ok" | "loading" }> }) {
  const { t } = useLanguage();
  if (gate.status === "missing") {
    return <p className="lede">{t("notFound.noCompanyBody")}</p>;
  }
  if (gate.status === "signedout") {
    return <p className="lede">{t("notFound.signInShort", { name: gate.customer.name })}</p>;
  }
  return <p className="lede">{t("notFound.notYoursBody")}</p>;
}
