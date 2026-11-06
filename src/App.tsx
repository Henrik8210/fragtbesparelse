import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell.tsx";
import { CustomerPage } from "./pages/CustomerPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { PortfolioPage } from "./pages/PortfolioPage.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<PortfolioPage />} />
          <Route path="/customers/:customerId" element={<CustomerPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
