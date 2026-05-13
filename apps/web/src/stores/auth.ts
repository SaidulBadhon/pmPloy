import { create } from "zustand";
import type { MeResponse, PublicTeam, PublicUser } from "@pmploy/shared";
import { api, ApiError } from "../lib/api";

type AuthState = {
  user: PublicUser | null;
  teams: PublicTeam[];
  currentTeamId: string | null;
  status: "loading" | "anonymous" | "authenticated";
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: {
    email: string;
    name: string;
    password: string;
    teamName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  setCurrentTeam: (teamId: string) => void;
  refreshTeams: () => Promise<void>;
};

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  teams: [],
  currentTeamId: null,
  status: "loading",

  async hydrate() {
    try {
      const me = await api<MeResponse>("/auth/me");
      set({
        user: me.user,
        teams: me.teams,
        currentTeamId: me.teams[0]?.id ?? null,
        status: "authenticated",
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        set({ user: null, teams: [], currentTeamId: null, status: "anonymous" });
      } else {
        set({ status: "anonymous" });
      }
    }
  },

  async login(email, password) {
    await api("/auth/login", { method: "POST", body: { email, password } });
    await get().hydrate();
  },

  async signup(input) {
    const me = await api<MeResponse>("/auth/signup", {
      method: "POST",
      body: input,
    });
    set({
      user: me.user,
      teams: me.teams,
      currentTeamId: me.teams[0]?.id ?? null,
      status: "authenticated",
    });
  },

  async logout() {
    await api("/auth/logout", { method: "POST" });
    set({ user: null, teams: [], currentTeamId: null, status: "anonymous" });
  },

  setCurrentTeam(teamId) {
    set({ currentTeamId: teamId });
  },

  async refreshTeams() {
    const me = await api<MeResponse>("/auth/me");
    set({
      user: me.user,
      teams: me.teams,
      currentTeamId: get().currentTeamId ?? me.teams[0]?.id ?? null,
    });
  },
}));
