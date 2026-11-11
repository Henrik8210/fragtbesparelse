import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import { knownCarrier } from "./data/carriers.ts";
import { useSession } from "./session.tsx";

const MAX_BILLS = 40;

export type BillSource = "manual" | "file";

export type Bill = {
  id: string;
  companyId: string;
  label: string;
  amount: number;
  source: BillSource;
  addedAt: string;
  carrier?: string;
};

type BillsContextValue = {
  billsFor: (customerId: string) => Bill[];
  totals: Record<string, number>;
  addBill: (customerId: string, draft: { label: string; amount: number; source: BillSource; carrier: string }) => void;
  removeBill: (customerId: string, billId: string) => void;
};

const BillsContext = createContext<BillsContextValue | null>(null);

export function BillsProvider({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  const [bills, setBills] = useState<Bill[]>([]);

  useEffect(() => {
    if (!ready || !session) {
      setBills([]);
      return;
    }
    let cancel = false;
    api<{ bills: Bill[] }>("/api/bills")
      .then((result) => {
        if (!cancel) setBills(result.bills);
      })
      .catch(() => {
        if (!cancel) setBills([]);
      });
    return () => {
      cancel = true;
    };
  }, [ready, session]);

  const totals: Record<string, number> = {};
  for (const bill of bills) totals[bill.companyId] = (totals[bill.companyId] ?? 0) + bill.amount;

  const value: BillsContextValue = {
    totals,
    billsFor(customerId) {
      return bills.filter((bill) => bill.companyId === customerId);
    },
    addBill(customerId, draft) {
      const amount = Math.round(draft.amount);
      if (!Number.isFinite(amount) || amount <= 0 || !knownCarrier(draft.carrier)) return;
      void api<{ bill: Bill }>(`/api/companies/${customerId}/bills`, {
        method: "POST",
        body: JSON.stringify({ ...draft, amount }),
      }).then((result) => {
        setBills((current) => [...current, result.bill].slice(-MAX_BILLS));
      });
    },
    removeBill(_customerId, billId) {
      void api(`/api/bills/${billId}`, { method: "DELETE" }).then(() => {
        setBills((current) => current.filter((bill) => bill.id !== billId));
      });
    },
  };

  return <BillsContext.Provider value={value}>{children}</BillsContext.Provider>;
}

export function useBillTotals(): Record<string, number> {
  const context = useContext(BillsContext);
  if (!context) throw new Error("useBillTotals must be used within BillsProvider");
  return context.totals;
}

export function useBills(customerId: string) {
  const context = useContext(BillsContext);
  if (!context) throw new Error("useBills must be used within BillsProvider");
  const bills = context.billsFor(customerId);
  const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
  return {
    bills,
    total,
    addBill: (draft: { label: string; amount: number; source: BillSource; carrier: string }) => context.addBill(customerId, draft),
    removeBill: (billId: string) => context.removeBill(customerId, billId),
  };
}
