import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api } from "./api.ts";
import { customers } from "./data/portfolio.ts";
import { useSession, type Session } from "./session.tsx";

export const ACCOUNT_ROLES = ["Owner", "Billing", "Operations"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export type AccountPerson = {
  id: string;
  name: string;
  username: string;
  role: AccountRole;
  customerId: string;
  sample: boolean;
  hasPassword: boolean;
};

export type AdminPerson = {
  id: string;
  name: string;
  username: string;
  sample: boolean;
  hasPassword: boolean;
};

type PeopleError = "name" | "customer" | "username" | "password" | "taken" | null;

type PeopleContextValue = {
  account: AccountPerson[];
  admins: AdminPerson[];
  addAccountUser: (draft: { name: string; username: string; password?: string; role: AccountRole; customerId: string }) => Promise<PeopleError>;
  addAdmin: (draft: { name: string; username: string; password: string }) => Promise<PeopleError>;
  setPassword: (id: string, password: string) => Promise<PeopleError>;
  removeAccountUser: (id: string) => void;
  removeAdmin: (id: string) => void;
};

const PeopleContext = createContext<PeopleContextValue | null>(null);

function isSeat(value: string | null): value is AccountRole {
  return ACCOUNT_ROLES.some((role) => role === value);
}

function fromSession(user: Session): { account?: AccountPerson; admin?: AdminPerson } {
  if (user.role === "admin") {
    return { admin: { id: user.id, name: user.name, username: user.username, sample: user.sample, hasPassword: user.hasPassword } };
  }
  if (!user.customerId || !isSeat(user.seat)) return {};
  return {
    account: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.seat,
      customerId: user.customerId,
      sample: user.sample,
      hasPassword: user.hasPassword,
    },
  };
}

export function PeopleProvider({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  const [account, setAccount] = useState<AccountPerson[]>([]);
  const [admins, setAdmins] = useState<AdminPerson[]>([]);

  useEffect(() => {
    if (!ready || !session) {
      setAccount([]);
      setAdmins([]);
      return;
    }
    let cancel = false;
    api<{ users: Session[] }>("/api/users")
      .then((result) => {
        if (cancel) return;
        const nextAccount: AccountPerson[] = [];
        const nextAdmins: AdminPerson[] = [];
        for (const user of result.users) {
          const mapped = fromSession(user);
          if (mapped.account && customers.some((company) => company.id === mapped.account?.customerId)) nextAccount.push(mapped.account);
          if (mapped.admin) nextAdmins.push(mapped.admin);
        }
        setAccount(nextAccount);
        setAdmins(nextAdmins);
      })
      .catch(() => {
        if (!cancel) {
          setAccount([]);
          setAdmins([]);
        }
      });
    return () => {
      cancel = true;
    };
  }, [ready, session]);

  async function addAccountUser(draft: {
    name: string;
    username: string;
    password?: string;
    role: AccountRole;
    customerId: string;
  }): Promise<PeopleError> {
    try {
      const result = await api<{ user: Session }>("/api/users", {
        method: "POST",
        body: JSON.stringify({ ...draft, kind: "customer", seat: draft.role }),
      });
      const mapped = fromSession(result.user).account;
      if (mapped) setAccount((current) => [...current, mapped]);
      return null;
    } catch (error) {
      if (error instanceof ApiError && (error.code === "name" || error.code === "customer" || error.code === "username" || error.code === "password" || error.code === "taken")) {
        return error.code;
      }
      return "name";
    }
  }

  async function addAdmin(draft: { name: string; username: string; password: string }): Promise<PeopleError> {
    try {
      const result = await api<{ user: Session }>("/api/users", {
        method: "POST",
        body: JSON.stringify({ ...draft, kind: "admin" }),
      });
      const mapped = fromSession(result.user).admin;
      if (mapped) setAdmins((current) => [...current, mapped]);
      return null;
    } catch (error) {
      if (error instanceof ApiError && (error.code === "name" || error.code === "username" || error.code === "password" || error.code === "taken")) {
        return error.code;
      }
      return "name";
    }
  }

  async function setPassword(id: string, password: string): Promise<PeopleError> {
    try {
      const result = await api<{ user: Session }>(`/api/users/${id}/password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      const mapped = fromSession(result.user);
      if (mapped.account) {
        const next = mapped.account;
        setAccount((current) => current.map((person) => (person.id === id ? next : person)));
      }
      if (mapped.admin) {
        const next = mapped.admin;
        setAdmins((current) => current.map((person) => (person.id === id ? next : person)));
      }
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.code === "password") return "password";
      return "name";
    }
  }

  const value: PeopleContextValue = {
    account,
    admins,
    addAccountUser,
    addAdmin,
    setPassword,
    removeAccountUser(id) {
      void api(`/api/users/${id}`, { method: "DELETE" }).then(() => {
        setAccount((current) => current.filter((person) => person.id !== id));
      });
    },
    removeAdmin(id) {
      void api(`/api/users/${id}`, { method: "DELETE" }).then(() => {
        setAdmins((current) => current.filter((person) => person.id !== id));
      });
    },
  };

  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

export function usePeople() {
  const context = useContext(PeopleContext);
  if (!context) throw new Error("usePeople must be used within PeopleProvider");
  return context;
}
