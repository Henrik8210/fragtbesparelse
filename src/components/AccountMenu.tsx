import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { customers } from "../data/portfolio.ts";
import { useLanguage } from "../language.tsx";
import { useSession } from "../session.tsx";
import { LoginPopup } from "./LoginPopup.tsx";

export function AccountMenu() {
  const { session, ready, signOut } = useSession();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [formReady, setFormReady] = useState(false);
  const markReady = useCallback(() => setFormReady(true), []);
  const close = useCallback(() => {
    setOpen(false);
    setFormReady(false);
  }, []);

  useEffect(() => {
    if (session) close();
  }, [session, close]);

  if (!ready) return null;
  if (!session) {
    const canSubmit = open && formReady;
    return (
      <div className={open ? "account is-open" : "account"}>
        <button
          type={canSubmit ? "submit" : "button"}
          form={canSubmit ? "fragtblik-login" : undefined}
          className="account-button"
          aria-expanded={open}
          aria-controls="login-popup"
          onClick={canSubmit ? undefined : () => setOpen(true)}
        >
          {t("account.signIn")}
        </button>
        {open
          ? createPortal(
              <button type="button" className="login-backdrop" aria-label={t("login.close")} onClick={close} />,
              document.body,
            )
          : null}
        {open ? <LoginPopup onReady={markReady} onClose={close} /> : null}
      </div>
    );
  }
  const company = session.role === "customer" ? customers.find((item) => item.id === session.customerId) : undefined;
  const label = session.role === "admin" ? session.name : (company?.name ?? session.name);
  return (
    <div className="account">
      <span className="account-name">{label}</span>
      <button
        type="button"
        className="bill-back"
        onClick={() => {
          void signOut().then(() => navigate("/"));
        }}
      >
        {t("account.logOut")}
      </button>
    </div>
  );
}
