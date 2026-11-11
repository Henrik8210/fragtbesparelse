import { Link, useNavigate } from "react-router-dom";
import { customers } from "../data/portfolio.ts";
import { useLanguage } from "../language.tsx";
import { useSession } from "../session.tsx";

export function AccountMenu() {
  const { session, ready, signOut } = useSession();
  const { t } = useLanguage();
  const navigate = useNavigate();
  if (!ready) return null;
  if (!session) {
    return (
      <Link className="account-button" to="/login">
        {t("account.signIn")}
      </Link>
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
          void signOut().then(() => navigate("/login"));
        }}
      >
        {t("account.logOut")}
      </button>
    </div>
  );
}
