import { useAuth } from "../stores/auth";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";

export default function DashboardPage() {
  const { user, teams, currentTeamId } = useAuth();
  const team = teams.find((t) => t.id === currentTeamId) ?? null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome, {user?.name}
        </h1>
        <p className="text-neutral-400">
          {team ? `Active team: ${team.name}` : "No team selected"}
        </p>
      </header>

      <Card>
        <CardTitle>No applications yet</CardTitle>
        <CardDescription className="mt-1">
          Connect a GitHub repo to deploy your first PM2 process. (Coming in the
          next milestone.)
        </CardDescription>
      </Card>
    </div>
  );
}
