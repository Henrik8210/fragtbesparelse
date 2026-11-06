import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell.tsx";
import { BillingPage, SettingsPage, UsersPage } from "./pages/AccountSpaces.tsx";
import { CustomerPage } from "./pages/CustomerPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { PortfolioPage } from "./pages/PortfolioPage.tsx";
import { WelcomePage } from "./pages/WelcomePage.tsx";
import { SessionProvider, useSession } from "./session.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/customers/:customerId" element={<CustomerPage />} />
            <Route path="/customers/:customerId/billing" element={<BillingPage />} />
            <Route path="/customers/:customerId/users" element={<UsersPage />} />
            <Route path="/customers/:customerId/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Shell>
      </SessionProvider>
    </BrowserRouter>
  );
}

function HomePage() {
  const { session } = useSession();
  if (session?.role === "customer") {
    return <Navigate to={`/customers/${session.customerId}`} replace />;
  }
  if (session?.role === "admin") return <PortfolioPage />;
  return <WelcomePage />;
}
