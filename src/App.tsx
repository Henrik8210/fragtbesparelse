import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Shell } from "./components/Shell.tsx";
import { BillsProvider } from "./bills.tsx";
import { PeopleProvider } from "./people.tsx";
import { BillingPage, BillsPage, SettingsPage, UsersPage } from "./pages/AccountSpaces.tsx";
import { CustomerPage } from "./pages/CustomerPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { CheckPage } from "./pages/CheckPage.tsx";
import { HistoryPage } from "./pages/HistoryPage.tsx";
import { PortfolioPage } from "./pages/PortfolioPage.tsx";
import { WelcomePage } from "./pages/WelcomePage.tsx";
import { TenderPage } from "./pages/TenderPage.tsx";
import { LanguageProvider } from "./language.tsx";
import { SessionProvider, useSession } from "./session.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
      <SessionProvider>
        <BillsProvider>
          <PeopleProvider>
            <Shell>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/login" element={<Navigate to="/" replace />} />
                <Route path="/billing" element={<BillingPage />} />
                <Route path="/billing/bills" element={<BillsPage />} />
                <Route path="/bills" element={<Navigate to="/billing/bills" replace />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/customers/:customerId" element={<CustomerPage />} />
                <Route path="/customers/:customerId/check" element={<CheckPage />} />
                <Route path="/customers/:customerId/history" element={<HistoryPage />} />
                <Route path="/customers/:customerId/tender" element={<TenderPage />} />
                <Route path="/customers/:customerId/billing" element={<BillingPage />} />
                <Route path="/customers/:customerId/billing/bills" element={<BillsPage />} />
                <Route path="/customers/:customerId/bills" element={<LegacyBillsRedirect />} />
                <Route path="/customers/:customerId/users" element={<UsersPage />} />
                <Route path="/customers/:customerId/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Shell>
          </PeopleProvider>
        </BillsProvider>
      </SessionProvider>
      </LanguageProvider>
    </BrowserRouter>
  );
}

function LegacyBillsRedirect() {
  const { customerId } = useParams();
  return <Navigate to={`/customers/${customerId}/billing/bills`} replace />;
}

function HomePage() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (session?.role === "customer" && session.customerId) {
    return <Navigate to={`/customers/${session.customerId}`} replace />;
  }
  if (session?.role === "admin") return <PortfolioPage />;
  return <WelcomePage />;
}
