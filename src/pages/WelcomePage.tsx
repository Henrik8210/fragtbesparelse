import { useEffect } from "react";
import { useLanguage } from "../language.tsx";

export function WelcomePage() {
  const { t } = useLanguage();
  useEffect(() => {
    document.title = t("welcome.docTitle");
  }, [t]);

  return (
    <div className="page">
      <h1>{t("welcome.title")}</h1>
      <p className="lede">{t("welcome.body")}</p>
      <p className="lede">{t("welcome.sample")}</p>
    </div>
  );
}
