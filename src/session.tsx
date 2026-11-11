import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import { useLanguage, type Lang } from "./language.tsx";

export type Session = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "customer";
  customerId: string | null;
  lang: Lang;
  sample: boolean;
  seat: string | null;
  hasPassword: boolean;
};

type SessionContextValue = {
  ready: boolean;
  session: Session | null;
  signIn: (username: string, password: string) => Promise<boolean>;
  adopt: (user: Session) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { adoptLang } = useLanguage();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancel = false;
    api<{ user: Session | null }>("/api/me")
      .then((result) => {
        if (cancel || !result.user) return;
        setSession(result.user);
        adoptLang(result.user.lang);
      })
      .catch(() => {
        if (!cancel) setSession(null);
      })
      .finally(() => {
        if (!cancel) setReady(true);
      });
    return () => {
      cancel = true;
    };
  }, [adoptLang]);

  async function signIn(username: string, password: string): Promise<boolean> {
    try {
      const result = await api<{ user: Session }>("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setSession(result.user);
      adoptLang(result.user.lang);
      return true;
    } catch {
      return false;
    }
  }

  function adopt(user: Session) {
    setSession(user);
    adoptLang(user.lang);
  }

  async function signOut() {
    await api("/api/logout", { method: "POST" }).catch(() => undefined);
    setSession(null);
    adoptLang("da");
  }

  return <SessionContext.Provider value={{ ready, session, signIn, adopt, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider missing");
  return value;
}
