import { useEffect, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useAuth } from "./stores/auth";
import AppShell from "./components/AppShell";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import AppsListPage from "./pages/AppsListPage";
import NewAppPage from "./pages/NewAppPage";
import AppDetailPage from "./pages/AppDetailPage";
import DeploymentDetailPage from "./pages/DeploymentDetailPage";
import TeamPage from "./pages/TeamPage";
import GithubSettingsPage from "./pages/GithubSettingsPage";
import PlatformPage from "./pages/PlatformPage";

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center text-neutral-500">
      Loading…
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === "loading") return <FullScreenLoader />;
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  if (status === "loading") return <FullScreenLoader />;
  if (status === "authenticated") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const hydrate = useAuth((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <LoginPage />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/signup"
          element={
            <RedirectIfAuthed>
              <SignupPage />
            </RedirectIfAuthed>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<AppsListPage />} />
          <Route path="apps/new" element={<NewAppPage />} />
          <Route path="apps/:appId" element={<AppDetailPage />} />
          <Route
            path="apps/:appId/deployments/:deploymentId"
            element={<DeploymentDetailPage />}
          />
          <Route path="team" element={<TeamPage />} />
          <Route path="settings/github" element={<GithubSettingsPage />} />
          <Route path="settings/platform" element={<PlatformPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
