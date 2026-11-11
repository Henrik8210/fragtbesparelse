import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../api.ts";
import { useLanguage } from "../language.tsx";
import { useSession } from "../session.tsx";

export function LoginPage() {
  const { t } = useLanguage();
  const { signIn, session, ready } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"loading" | "setup" | "sign-in">("loading");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [failed, setFailed] = useState(false);
  const [short, setShort] = useState(false);

  useEffect(() => {
    document.title = `${t("login.title")} · Fragtblik`;
  }, [t]);

  useEffect(() => {
    if (!ready || !session) return;
    navigate(session.role === "customer" && session.customerId ? `/customers/${session.customerId}` : "/", { replace: true });
  }, [navigate, ready, session]);

  useEffect(() => {
    api<{ needsAdminPassword: boolean }>("/api/sign-in-state").then((result) => {
      setMode(result.needsAdminPassword ? "setup" : "sign-in");
    });
  }, []);

  async function choosePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    setShort(false);
    try {
      await api("/api/admin-password", { method: "POST", body: JSON.stringify({ password }) });
      setPassword("");
      setMode("sign-in");
    } catch (error) {
      if (error instanceof ApiError && error.code === "password") setShort(true);
      else setFailed(true);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await signIn(username, password);
    setFailed(!ok);
  }

  return (
    <div className="page">
      <h1>{t("login.title")}</h1>
      {mode === "setup" ? (
        <>
          <p className="lede">{t("login.setupLead")}</p>
          <p className="meta">{t("login.setupUser")}</p>
          <form className="bill-form" onSubmit={(event) => void choosePassword(event)}>
            <label className="bill-field">
              <span>{t("login.password")}</span>
              <input
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <button type="submit" className="bill-choice">
              {t("login.setupSubmit")}
            </button>
            {short ? <p className="bill-errors">{t("login.setupShort")}</p> : null}
            {failed ? <p className="bill-errors">{t("login.setupFailed")}</p> : null}
          </form>
        </>
      ) : null}
      {mode === "sign-in" ? (
        <>
          <p className="lede">{t("login.lead")}</p>
          <form className="bill-form" onSubmit={(event) => void submit(event)}>
            <label className="bill-field">
              <span>{t("login.username")}</span>
              <input name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
            </label>
            <label className="bill-field">
              <span>{t("login.password")}</span>
              <input
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit" className="bill-choice">
              {t("login.submit")}
            </button>
            {failed ? <p className="bill-errors">{t("login.failed")}</p> : null}
          </form>
        </>
      ) : null}
    </div>
  );
}
