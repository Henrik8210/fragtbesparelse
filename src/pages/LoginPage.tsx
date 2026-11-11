import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { useLanguage } from "../language.tsx";
import { useSession } from "../session.tsx";

type SampleUser = { username: string; name: string; role: "admin" | "customer"; company: string | null };

export function LoginPage() {
  const { t } = useLanguage();
  const { signIn, session, ready } = useSession();
  const navigate = useNavigate();
  const [users, setUsers] = useState<SampleUser[]>([]);
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [samplePassword, setSamplePassword] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = `${t("login.title")} · Fragtblik`;
  }, [t]);

  useEffect(() => {
    if (!ready || !session) return;
    navigate(session.role === "customer" && session.customerId ? `/customers/${session.customerId}` : "/", { replace: true });
  }, [navigate, ready, session]);

  useEffect(() => {
    api<{ password: string; users: SampleUser[] }>("/api/sample-sign-in").then((result) => {
      setUsers(result.users);
      setSamplePassword(result.password);
      setPassword(result.password);
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await signIn(username, password);
    setFailed(!ok);
  }

  return (
    <div className="page">
      <h1>{t("login.title")}</h1>
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
            type="text"
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
      <section className="block">
        <h2>{t("login.sampleTitle")}</h2>
        <p className="section-intro">{t("login.samplePassword", { password: samplePassword })}</p>
        <ul className="seat-list">
          {users.map((user) => (
            <li key={user.username}>
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setUsername(user.username);
                  setPassword(samplePassword);
                }}
              >
                <span className="seat-role">{user.name}</span>
                <span className="seat-person-role">
                  {user.username}
                  {user.company ? ` · ${user.company}` : ` · ${t("login.admin")}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
