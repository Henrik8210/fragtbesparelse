import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../language.tsx";

export function NotFound({ title, body }: { title?: string; body?: string }) {
  const { t } = useLanguage();
  const heading = title ?? t("notFound.title");
  const text = body ?? t("notFound.body");
  useEffect(() => {
    document.title = `${heading} · Fairlane`;
  }, [heading]);

  return (
    <div className="page">
      <h1>{heading}</h1>
      <p className="lede">{text}</p>
      <p>
        <Link className="text-link" to="/">
          {t("common.home")}
        </Link>
      </p>
    </div>
  );
}
