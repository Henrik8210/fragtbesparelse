import { useEffect } from "react";

export function WelcomePage() {
  useEffect(() => {
    document.title = "Sign in · Fairlane";
  }, []);

  return (
    <div className="page">
      <h1>Your freight account</h1>
      <p className="lede">
        Sign in from the upper right to see what one company paid, a sample fair price for the same
        shipments, and where the gap is. A company account shows only that company. A Fairlane admin
        can open every sample account.
      </p>
      <p className="lede">Every figure in Fairlane is invented sample data. There is no password.</p>
    </div>
  );
}
