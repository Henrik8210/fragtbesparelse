import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { customers } from "./data/portfolio.ts";

const STORAGE_KEY = "fairlane-people";
const MAX_PEOPLE = 40;

export const ACCOUNT_ROLES = ["Owner", "Billing", "Operations"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ROLE_ACCESS: Record<AccountRole, string> = {
  Owner: "The whole account",
  Billing: "Spend and the budget",
  Operations: "Lanes and carriers",
};

export type AccountPerson = {
  id: string;
  name: string;
  role: AccountRole;
  customerId: string;
};

export type AdminPerson = {
  id: string;
  name: string;
};

type PeopleStore = {
  account: AccountPerson[];
  admins: AdminPerson[];
};

type PeopleContextValue = {
  account: AccountPerson[];
  admins: AdminPerson[];
  addAccountUser: (draft: { name: string; role: AccountRole; customerId: string }) => string | null;
  addAdmin: (name: string) => string | null;
  removeAccountUser: (id: string) => void;
  removeAdmin: (id: string) => void;
};

const PeopleContext = createContext<PeopleContextValue | null>(null);

function cleanName(value: string): string {
  let cleaned = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    cleaned += code < 32 || code === 127 ? " " : char;
  }
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 80);
}

function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === "string" && ACCOUNT_ROLES.some((role) => role === value);
}

function isAccountPerson(value: unknown): value is AccountPerson {
  if (!value || typeof value !== "object") return false;
  const person = value as Record<string, unknown>;
  return (
    typeof person.id === "string" &&
    person.id.length > 0 &&
    typeof person.name === "string" &&
    person.name.length > 0 &&
    isAccountRole(person.role) &&
    typeof person.customerId === "string" &&
    customers.some((customer) => customer.id === person.customerId)
  );
}

function isAdminPerson(value: unknown): value is AdminPerson {
  if (!value || typeof value !== "object") return false;
  const person = value as Record<string, unknown>;
  return typeof person.id === "string" && person.id.length > 0 && typeof person.name === "string" && person.name.length > 0;
}

function readStore(): PeopleStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { account: [], admins: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { account: [], admins: [] };
    const record = parsed as Record<string, unknown>;
    const account = Array.isArray(record.account) ? record.account.filter(isAccountPerson).slice(-MAX_PEOPLE) : [];
    const admins = Array.isArray(record.admins) ? record.admins.filter(isAdminPerson).slice(-MAX_PEOPLE) : [];
    return { account, admins };
  } catch {
    return { account: [], admins: [] };
  }
}

export function PeopleProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<PeopleStore>(readStore);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // People still show for this visit if storage is unavailable.
    }
  }, [store]);

  const value: PeopleContextValue = {
    account: store.account,
    admins: store.admins,
    addAccountUser(draft) {
      const name = cleanName(draft.name);
      if (!name) return "Enter a name.";
      if (!isAccountRole(draft.role) || !customers.some((customer) => customer.id === draft.customerId)) {
        return "Choose a customer account.";
      }
      const person: AccountPerson = {
        id: crypto.randomUUID(),
        name,
        role: draft.role,
        customerId: draft.customerId,
      };
      setStore((current) => ({ ...current, account: [...current.account, person].slice(-MAX_PEOPLE) }));
      return null;
    },
    addAdmin(name) {
      const cleaned = cleanName(name);
      if (!cleaned) return "Enter a name.";
      const person: AdminPerson = { id: crypto.randomUUID(), name: cleaned };
      setStore((current) => ({ ...current, admins: [...current.admins, person].slice(-MAX_PEOPLE) }));
      return null;
    },
    removeAccountUser(id) {
      setStore((current) => ({ ...current, account: current.account.filter((person) => person.id !== id) }));
    },
    removeAdmin(id) {
      setStore((current) => ({ ...current, admins: current.admins.filter((person) => person.id !== id) }));
    },
  };

  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

export function usePeople() {
  const context = useContext(PeopleContext);
  if (!context) throw new Error("usePeople must be used within PeopleProvider");
  return context;
}
