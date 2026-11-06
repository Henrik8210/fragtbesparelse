import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { customers } from "./data/portfolio.ts";

const STORAGE_KEY = "fairlane-bills";
const MAX_BILLS = 40;

export type BillSource = "manual" | "file";

export type Bill = {
  id: string;
  label: string;
  amount: number;
  source: BillSource;
  addedAt: string;
};

type BillStore = Record<string, Bill[]>;

type BillsContextValue = {
  billsFor: (customerId: string) => Bill[];
  totals: Record<string, number>;
  addBill: (customerId: string, draft: { label: string; amount: number; source: BillSource }) => void;
  removeBill: (customerId: string, billId: string) => void;
};

const BillsContext = createContext<BillsContextValue | null>(null);

function cleanLabel(label: string): string {
  let cleaned = "";
  for (const char of label) {
    const code = char.charCodeAt(0);
    cleaned += code < 32 || code === 127 ? " " : char;
  }
  const compact = cleaned.replace(/\s+/g, " ").trim().slice(0, 120);
  return compact || "Freight bill";
}

function isBill(value: unknown): value is Bill {
  if (!value || typeof value !== "object") return false;
  const bill = value as Record<string, unknown>;
  return (
    typeof bill.id === "string" &&
    bill.id.length > 0 &&
    bill.id.length < 80 &&
    typeof bill.label === "string" &&
    typeof bill.amount === "number" &&
    Number.isFinite(bill.amount) &&
    bill.amount > 0 &&
    bill.amount <= 1_000_000_000_000 &&
    (bill.source === "manual" || bill.source === "file") &&
    typeof bill.addedAt === "string"
  );
}

function readStore(): BillStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const store: BillStore = {};
    for (const customer of customers) {
      const entry = (parsed as Record<string, unknown>)[customer.id];
      if (!Array.isArray(entry)) continue;
      const bills = entry.filter(isBill).slice(-MAX_BILLS);
      if (bills.length > 0) store[customer.id] = bills;
    }
    return store;
  } catch {
    return {};
  }
}

export function BillsProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<BillStore>(readStore);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // The bills still show for this visit if storage is unavailable.
    }
  }, [store]);

  const totals: Record<string, number> = {};
  for (const [customerId, bills] of Object.entries(store)) {
    totals[customerId] = bills.reduce((sum, bill) => sum + bill.amount, 0);
  }

  const value: BillsContextValue = {
    totals,
    billsFor(customerId) {
      return store[customerId] ?? [];
    },
    addBill(customerId, draft) {
      const amount = Math.round(draft.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) return;
      const bill: Bill = {
        id: crypto.randomUUID(),
        label: cleanLabel(draft.label),
        amount,
        source: draft.source,
        addedAt: new Date().toISOString(),
      };
      setStore((current) => {
        const existing = current[customerId] ?? [];
        return { ...current, [customerId]: [...existing, bill].slice(-MAX_BILLS) };
      });
    },
    removeBill(customerId, billId) {
      setStore((current) => {
        const existing = current[customerId] ?? [];
        const next = existing.filter((bill) => bill.id !== billId);
        if (next.length === existing.length) return current;
        return { ...current, [customerId]: next };
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
    addBill: (draft: { label: string; amount: number; source: BillSource }) => context.addBill(customerId, draft),
    removeBill: (billId: string) => context.removeBill(customerId, billId),
  };
}
