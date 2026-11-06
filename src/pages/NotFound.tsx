import { useEffect } from "react";
import { Link } from "react-router-dom";

export function NotFound({
  title = "This page is not in the sample",
  body = "Fairlane only includes the fictional companies in the portfolio. Every figure in the app is sample data.",
}: {
  title?: string;
  body?: string;
}) {
  useEffect(() => {
    document.title = `${title} · Fairlane`;
  }, [title]);

  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="lede">{body}</p>
      <p>
        <Link className="text-link" to="/">
          Home
        </Link>
      </p>
    </div>
  );
}
