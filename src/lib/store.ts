import { create } from "zustand";
import type {
  ActiveNavTab,
  ApiKeyStatus,
  BackupRecord,
  CliDefinition,
  RegistryItem,
  SessionInfo,
  TeamMemberRecord,
  UsageDashboardData,
} from "../types/types";

interface ToastNotice {
  id: number;
  text: string;
  tone: "success" | "info" | "error";
}

interface AppStoreState {
  activeNav: ActiveNavTab;
  clis: CliDefinition[];
  sessions: SessionInfo[];
  activeSessionId: string | null;
  splitSessionId: string | null;
  apiKeys: ApiKeyStatus[];
  usageDashboard: UsageDashboardData | null;
  usageCliFilter: string;
  usageTimeframe: string;
  registryItems: RegistryItem[];
  backups: BackupRecord[];
  teamMembers: TeamMemberRecord[];
  toast: ToastNotice | null;

  setActiveNav: (nav: ActiveNavTab) => void;
  setClis: (clis: CliDefinition[]) => void;
  setSessions: (sessions: SessionInfo[]) => void;
  addSession: (session: SessionInfo) => void;
  removeSession: (sessionId: string) => void;
  setActiveSessionId: (id: string | null) => void;
  setSplitSessionId: (id: string | null) => void;
  setApiKeys: (keys: ApiKeyStatus[]) => void;
  setUsageDashboard: (data: UsageDashboardData) => void;
  setUsageCliFilter: (filter: string) => void;
  setUsageTimeframe: (timeframe: string) => void;
  setRegistryItems: (items: RegistryItem[]) => void;
  setBackups: (backups: BackupRecord[]) => void;
  setTeamMembers: (members: TeamMemberRecord[]) => void;
  showToast: (text: string, tone?: "success" | "info" | "error") => void;
}

const getCachedUsageDashboard = (): UsageDashboardData | null => {
  try {
    const raw = localStorage.getItem("ai_cli_cached_usage_dashboard");
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
};

export const useAppStore = create<AppStoreState>((set) => ({
  activeNav: "terminal",
  clis: [],
  sessions: [],
  activeSessionId: null,
  splitSessionId: null,
  apiKeys: [],
  usageDashboard: getCachedUsageDashboard(),
  usageCliFilter: "all",
  usageTimeframe: "7d",
  registryItems: [],
  backups: [],
  teamMembers: [],
  toast: null,

  setActiveNav: (activeNav) => set({ activeNav }),
  setClis: (clis) => set({ clis }),
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: session.id,
      activeNav: "terminal",
    })),
  removeSession: (sessionId) =>
    set((state) => {
      const next = state.sessions.filter((s) => s.id !== sessionId);
      const nextActive =
        state.activeSessionId === sessionId
          ? next.length > 0
            ? next[next.length - 1].id
            : null
          : state.activeSessionId;
      const nextSplit =
        state.splitSessionId === sessionId ? null : state.splitSessionId;
      return {
        sessions: next,
        activeSessionId: nextActive,
        splitSessionId: nextSplit,
      };
    }),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setSplitSessionId: (splitSessionId) => set({ splitSessionId }),
  setApiKeys: (apiKeys) => set({ apiKeys }),
  setUsageDashboard: (usageDashboard) => {
    try {
      localStorage.setItem(
        "ai_cli_cached_usage_dashboard",
        JSON.stringify(usageDashboard)
      );
    } catch {}
    set({ usageDashboard });
  },
  setUsageCliFilter: (usageCliFilter) => set({ usageCliFilter }),
  setUsageTimeframe: (usageTimeframe) => set({ usageTimeframe }),
  setRegistryItems: (registryItems) => set({ registryItems }),
  setBackups: (backups) => set({ backups }),
  setTeamMembers: (teamMembers) => set({ teamMembers }),
  showToast: (text, tone = "info") => {
    const id = Date.now();
    set({ toast: { id, text, tone } });
    setTimeout(() => {
      set((s) => (s.toast?.id === id ? { toast: null } : s));
    }, 3600);
  },
}));
