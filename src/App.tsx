import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Shell } from "./components/Shell.tsx";
import { BillsProvider } from "./bills.tsx";
import { PeopleProvider } from "./people.tsx";
import { BillingPage, BillsPage, SettingsPage, UsersPage } from "./pages/AccountSpaces.tsx";
import { CustomerPage } from "./pages/CustomerPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { PortfolioPage } from "./pages/PortfolioPage.tsx";
import { WelcomePage } from "./pages/WelcomePage.tsx";
import { SessionProvider, useSession } from "./session.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <BillsProvider>
          <PeopleProvider>
            <Shell>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/billing" element={<BillingPage />} />
                <Route path="/billing/bills" element={<BillsPage />} />
                <Route path="/bills" element={<Navigate to="/billing/bills" replace />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/customers/:customerId" element={<CustomerPage />} />
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
    </BrowserRouter>
  );
}

function LegacyBillsRedirect() {
  const { customerId } = useParams();
  return <Navigate to={`/customers/${customerId}/billing/bills`} replace />;
}

function HomePage() {
  const { session } = useSession();
  if (session?.role === "customer") {
    return <Navigate to={`/customers/${session.customerId}`} replace />;
  }
  if (session?.role === "admin") return <PortfolioPage />;
  return <WelcomePage />;
}
