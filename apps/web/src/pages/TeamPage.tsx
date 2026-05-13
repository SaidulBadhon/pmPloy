import { useEffect, useState, type FormEvent } from "react";
import type { Role, TeamMember } from "@pmploy/shared";
import { useAuth } from "../stores/auth";
import { api } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Input";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";

const inviteRoles: Exclude<Role, "owner">[] = ["admin", "member", "viewer"];

export default function TeamPage() {
  const { teams, currentTeamId, refreshTeams, user } = useAuth();
  const team = teams.find((t) => t.id === currentTeamId) ?? null;
  const canManage = team?.role === "owner" || team?.role === "admin";

  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<Role, "owner">>("member");
  const [inviting, setInviting] = useState(false);

  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    setMembers(null);
    setNewName(team?.name ?? "");
    if (!currentTeamId) return;
    api<{ members: TeamMember[] }>(`/teams/${currentTeamId}/members`)
      .then((d) => setMembers(d.members))
      .catch((e: Error) => setError(e.message));
  }, [currentTeamId, team?.name]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!currentTeamId) return;
    setInviting(true);
    setError(null);
    try {
      const m = await api<TeamMember>(`/teams/${currentTeamId}/members`, {
        method: "POST",
        body: { email: inviteEmail, role: inviteRole },
      });
      setMembers((cur) => (cur ? [...cur, m] : [m]));
      setInviteEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "invite failed");
    } finally {
      setInviting(false);
    }
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (!currentTeamId || !newName.trim()) return;
    setRenaming(true);
    try {
      await api(`/teams/${currentTeamId}`, {
        method: "PATCH",
        body: { name: newName },
      });
      await refreshTeams();
    } catch (err) {
      setError(err instanceof Error ? err.message : "rename failed");
    } finally {
      setRenaming(false);
    }
  }

  async function changeRole(userId: string, role: Exclude<Role, "owner">) {
    if (!currentTeamId) return;
    await api(`/teams/${currentTeamId}/members/${userId}`, {
      method: "PATCH",
      body: { role },
    });
    setMembers((cur) =>
      cur ? cur.map((m) => (m.userId === userId ? { ...m, role } : m)) : cur,
    );
  }

  async function removeMember(userId: string) {
    if (!currentTeamId) return;
    await api(`/teams/${currentTeamId}/members/${userId}`, { method: "DELETE" });
    setMembers((cur) => (cur ? cur.filter((m) => m.userId !== userId) : cur));
  }

  if (!team) return <p className="text-neutral-400">No team selected.</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-neutral-400">
          {team.name} · slug: <code>{team.slug}</code> · your role:{" "}
          <span className="font-mono">{team.role}</span>
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {canManage && (
        <Card>
          <CardTitle>Rename team</CardTitle>
          <form onSubmit={onRename} className="mt-4 flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="team-name">Name</Label>
              <Input
                id="team-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={renaming || newName === team.name}>
              {renaming ? "Saving…" : "Save"}
            </Button>
          </form>
        </Card>
      )}

      <Card>
        <CardTitle>Members</CardTitle>
        <CardDescription className="mt-1">
          People with access to this team's apps.
        </CardDescription>
        <ul className="mt-4 divide-y divide-neutral-800">
          {members?.map((m) => {
            const isOwner = m.role === "owner";
            const isSelf = m.userId === user?.id;
            return (
              <li key={m.userId} className="flex items-center gap-4 py-3">
                <div className="flex-1">
                  <p className="font-medium">{m.name}</p>
                  <p className="text-sm text-neutral-400">{m.email}</p>
                </div>
                {canManage && !isOwner ? (
                  <select
                    value={m.role}
                    onChange={(e) =>
                      changeRole(m.userId, e.target.value as Exclude<Role, "owner">)
                    }
                    className="h-8 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm"
                  >
                    {inviteRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded-full border border-neutral-700 px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-neutral-300">
                    {m.role}
                  </span>
                )}
                {canManage && !isOwner && !isSelf && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => removeMember(m.userId)}
                  >
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
          {members === null && <li className="py-3 text-neutral-500">Loading…</li>}
        </ul>
      </Card>

      {canManage && (
        <Card>
          <CardTitle>Invite member</CardTitle>
          <CardDescription className="mt-1">
            The user must already have a pmPloy account.
          </CardDescription>
          <form onSubmit={onInvite} className="mt-4 flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as Exclude<Role, "owner">)
                }
                className="h-10 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm"
              >
                {inviteRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={inviting}>
              {inviting ? "Adding…" : "Add"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
