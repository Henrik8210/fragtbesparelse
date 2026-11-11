import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "../api.ts";
import type { MessageKey } from "../i18n/messages.ts";
import { useLanguage } from "../language.tsx";
import { useSession, type Session } from "../session.tsx";

export function LoginPopup({ onReady, onClose }: { onReady: () => void; onClose: () => void }) {
  const { t } = useLanguage();
  const { signIn, adopt } = useSession();
  const [mode, setMode] = useState<"loading" | "setup" | "owner" | "sign-in" | "create">("loading");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [failed, setFailed] = useState(false);
  const [short, setShort] = useState(false);
  const [createCode, setCreateCode] = useState("");

  useEffect(() => {
    let cancel = false;
    api<{ needsAdminPassword?: boolean; canChooseAdminPassword?: boolean }>("/api/sign-in-state")
      .then((result) => {
        if (cancel) return;
        if (result?.needsAdminPassword && result.canChooseAdminPassword) setMode("setup");
        else if (result?.needsAdminPassword) setMode("owner");
        else setMode("sign-in");
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
      setUsername("admin");
      setMode("sign-in");
    } catch (error) {
      if (error instanceof ApiError && error.code === "password") setShort(true);
      else setFailed(true);
    }
  }

  function createReason(code: string): MessageKey {
    if (code === "taken") return "login.createTaken";
    if (code === "username") return "login.createUsername";
    if (code === "missing_header") return "login.createMissing";
    if (code === "issuer_unreachable") return "login.createUnreachable";
    if (code === "expired") return "login.createExpired";
    if (code === "sign_in_required" || code === "sign-in") return "login.createSignIn";
    if (code === "not_owner" || code === "forbidden") return "login.createDenied";
    if (code === "server" || code === "error") return "login.createServer";
    return "login.createRejected";
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    setShort(false);
    setCreateCode("");
    const chosenName = username;
    const chosenPassword = password;
    try {
      const result = await api<{ user?: Session }>("/api/register", {
        method: "POST",
        body: JSON.stringify({ username: chosenName, password: chosenPassword }),
      });
      setPassword("");
      if (!result?.user) {
        setCreateCode("server");
        setFailed(true);
        return;
      }
      adopt(result.user);
    } catch (error) {
      if (error instanceof ApiError && error.code === "password") setShort(true);
      else {
        setCreateCode(error instanceof ApiError ? error.code : "error");
        setFailed(true);
      }
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
      {mode === "owner" ? (
        <>
          <p className="login-note">{t("login.setupDenied")}</p>
          <button
            type="button"
            className="text-link login-create"
            onClick={() => {
              setFailed(false);
              setShort(false);
              setPassword("");
              setMode("create");
            }}
          >
            {t("login.create")}
          </button>
        </>
      ) : null}
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
          <button
            type="button"
            className="text-link login-create"
            onClick={() => {
              setFailed(false);
              setShort(false);
              setPassword("");
              setMode("create");
            }}
          >
            {t("login.create")}
          </button>
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
          <button
            type="button"
            className="text-link login-create"
            onClick={() => {
              setFailed(false);
              setShort(false);
              setPassword("");
              setMode("create");
            }}
          >
            {t("login.create")}
          </button>
        </>
      ) : null}
      {mode === "create" ? (
        <>
          <p className="login-note">{t("login.createLead")}</p>
          <form id="fragtblik-login" className="bill-form" onSubmit={(event) => void createUser(event)}>
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
                autoComplete="new-password"
                required
              />
            </label>
            <button type="submit" className="bill-choice">
              {t("login.create")}
            </button>
            {short ? <p className="bill-errors">{t("login.setupShort")}</p> : null}
            {failed ? <p className="bill-errors">{t(createReason(createCode))}</p> : null}
          </form>
          <button
            type="button"
            className="text-link login-create"
            onClick={() => {
              setFailed(false);
              setShort(false);
              setPassword("");
              setMode("sign-in");
            }}
          >
            {t("common.back")}
          </button>
        </>
      ) : null}
    </div>
  );
}
