import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { Button } from "./ui/Button";
import { cn } from "../lib/cn";

const navItems = [
  { to: "/", label: "Apps", end: true },
  { to: "/team", label: "Team" },
];

export default function AppShell() {
  const { user, teams, currentTeamId, setCurrentTeam, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            pmPloy
          </Link>

          <select
            value={currentTeamId ?? ""}
            onChange={(e) => setCurrentTeam(e.target.value)}
            className="h-8 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm text-neutral-100"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.role}
              </option>
            ))}
          </select>

          <nav className="ml-2 flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm",
                    isActive
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-400 hover:text-neutral-100",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-neutral-400">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
