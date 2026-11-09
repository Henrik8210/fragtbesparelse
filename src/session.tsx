import { createContext, useContext, useState, type ReactNode } from "react";
import { customers } from "./data/portfolio.ts";

const STORAGE_KEY = "fairlane-session";

function cleanName(value: string): string {
  return stripControls(value).replace(/\s+/g, " ").trim().slice(0, 80);
}

function stripControls(value: string): string {
  let cleaned = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    cleaned += code < 32 || code === 127 ? " " : char;
  }
  return cleaned;
}

export type Session = { role: "admin"; name?: string } | { role: "customer"; customerId: string };

type SessionContextValue = {
  session: Session | null;
  signIn: (session: Session) => void;
  signOut: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("role" in parsed)) return null;
    if (parsed.role === "admin") {
      const name = "name" in parsed && typeof parsed.name === "string" ? cleanName(parsed.name) : "";
      return name ? { role: "admin", name } : { role: "admin" };
    }
    if (
      parsed.role === "customer" &&
      "customerId" in parsed &&
      typeof parsed.customerId === "string" &&
      customers.some((customer) => customer.id === parsed.customerId)
    ) {
      return { role: "customer", customerId: parsed.customerId };
    }
  } catch {
    // A blocked or unreadable store just means signed out.
  }
  return null;
}

function storeSession(session: Session | null) {
  try {
    if (!session) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // The sign-in still applies until the tab closes.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession);

  function signIn(next: Session) {
    storeSession(next);
    setSession(next);
  }

  function signOut() {
    storeSession(null);
    setSession(null);
  }

  return <SessionContext.Provider value={{ session, signIn, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider missing");
  return value;
}
