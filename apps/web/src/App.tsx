import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { useMe } from "./api/queries";
import { Shell } from "./components/Shell";
import { ErrorState, Loading } from "./components/States";
import { BrandKitsPage } from "./pages/BrandKits";
import { CalendarPage } from "./pages/Calendar";
import { DashboardPage } from "./pages/Dashboard";
import { ImportsPage } from "./pages/Imports";
import { LoginPage } from "./pages/Login";
import { NewTaskPage } from "./pages/NewTask";
import { SocialAccountsPage } from "./pages/SocialAccounts";
import { TaskPage } from "./pages/TaskPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 } },
});

// Everything behind the session: /me is the single source of truth for
// identity and grants; a 401 sends the visitor to the login page.
function Authenticated() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Loading label="Ouverture de la session…" />;
  if (me.isError) {
    if (me.error.status === 401) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    return <ErrorState error={me.error} retry={() => void me.refetch()} />;
  }
  return (
    <Shell me={me.data}>
      <Routes>
        <Route index element={<Navigate to="/today" replace />} />
        <Route path="imports" element={<ImportsPage me={me.data} />} />
        <Route path="brand-kits" element={<BrandKitsPage me={me.data} />} />
        <Route path="calendar" element={<CalendarPage me={me.data} />} />
        <Route path="social-accounts" element={<SocialAccountsPage me={me.data} />} />
        <Route path="tasks/new" element={<NewTaskPage me={me.data} />} />
        <Route path="tasks/:id" element={<TaskPage me={me.data} />} />
        <Route path=":view" element={<DashboardPage me={me.data} />} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<Authenticated />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
