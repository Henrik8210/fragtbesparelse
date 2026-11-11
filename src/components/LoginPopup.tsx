import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "../api.ts";
import { useLanguage } from "../language.tsx";
import { useSession } from "../session.tsx";

export function LoginPopup({ onReady, onClose }: { onReady: () => void; onClose: () => void }) {
  const { t } = useLanguage();
  const { signIn } = useSession();
  const [mode, setMode] = useState<"loading" | "setup" | "sign-in">("loading");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [failed, setFailed] = useState(false);
  const [short, setShort] = useState(false);

  useEffect(() => {
    let cancel = false;
    api<{ needsAdminPassword?: boolean }>("/api/sign-in-state")
      .then((result) => {
        if (cancel) return;
        setMode(result?.needsAdminPassword ? "setup" : "sign-in");
        onReady();
      })
      .catch(() => {
        if (cancel) return;
        setMode("sign-in");
        onReady();
      });
    return () => {
      cancel = true;
    };
  }, [onReady]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function choosePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    setShort(false);
    try {
      await api("/api/admin-password", { method: "POST", body: JSON.stringify({ password }) });
      setPassword("");
      setUsername("");
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
    <div className="login-pop" id="login-popup" role="dialog" aria-labelledby="login-pop-title">
      <div className="login-pop-head">
        <h2 id="login-pop-title">{t("login.title")}</h2>
        <button type="button" className="login-close" onClick={onClose} aria-label={t("login.close")}>
          ×
        </button>
      </div>
      {mode === "setup" ? (
        <>
          <p className="login-note">{t("login.setupLead")}</p>
          <form id="fragtblik-login" className="bill-form" onSubmit={(event) => void choosePassword(event)}>
            <label className="bill-field">
              <span>{t("login.password")}</span>
              <input
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                autoFocus
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
          <p className="login-note">{t("login.lead")}</p>
          <form id="fragtblik-login" className="bill-form" onSubmit={(event) => void submit(event)}>
            <label className="bill-field">
              <span>{t("login.username")}</span>
              <input
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
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
