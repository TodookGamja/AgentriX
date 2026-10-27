import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type {
  ApiKeyStatus,
  ApplyResult,
  BackupRecord,
  CliDefinition,
  CustomCliInput,
  DetectedCliCredential,
  DirectoryListing,
  ProjectAgentInput,
  ProjectAgentRecord,
  ProjectAnalysisResult,
  ProjectDeepContext,
  ProjectFolderRecord,
  PtyOutputChunk,
  RegistryItem,
  SessionInfo,
  TeamMemberRecord,
  UsageDashboardData,
} from "../types/types";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

const fallbackBuffers = new Map<string, string>();
const fallbackListeners = new Set<(payload: { sessionId: string; data: string }) => void>();

export async function apiDetectClis(): Promise<CliDefinition[]> {
  if (isTauriRuntime()) {
    return invoke<CliDefinition[]>("detect_clis");
  }
  return [];
}

export async function apiAddCustomCli(input: CustomCliInput): Promise<CliDefinition[]> {
  if (isTauriRuntime()) {
    return invoke<CliDefinition[]>("add_custom_cli", { input });
  }
  return [];
}

export async function apiDeleteCustomCli(cliId: string): Promise<CliDefinition[]> {
  if (isTauriRuntime()) {
    return invoke<CliDefinition[]>("delete_custom_cli", { cliId });
  }
  return [];
}

export async function apiGetProjectFolders(): Promise<ProjectFolderRecord[]> {
  if (isTauriRuntime()) {
    return invoke<ProjectFolderRecord[]>("get_project_folders");
  }
  return [];
}

export async function apiAddProjectFolder(path: string): Promise<ProjectFolderRecord[]> {
  if (isTauriRuntime()) {
    return invoke<ProjectFolderRecord[]>("add_project_folder", { path });
  }
  return [];
}

export async function apiDeleteProjectFolder(path: string): Promise<ProjectFolderRecord[]> {
  if (isTauriRuntime()) {
    return invoke<ProjectFolderRecord[]>("delete_project_folder", { path });
  }
  return [];
}

export async function apiSetAppThemeMode(theme: string): Promise<void> {
  if (isTauriRuntime()) {
    return invoke("set_app_theme_mode", { theme });
  }
}

export async function apiPickProjectFolder(theme?: string): Promise<string | null> {
  if (isTauriRuntime()) {
    return invoke<string | null>("pick_project_folder", { theme });
  }
  return null;
}

export async function apiListDirectoryEntries(path?: string): Promise<DirectoryListing | null> {
  if (isTauriRuntime()) {
    return invoke<DirectoryListing>("list_directory_entries", { path });
  }
  return null;
}

export async function apiGetProjectAgents(
  projectPath: string
): Promise<ProjectAgentRecord[]> {
  if (isTauriRuntime() && projectPath.trim()) {
    return invoke<ProjectAgentRecord[]>("get_project_agents", { projectPath });
  }
  return [];
}

export async function apiUpsertProjectAgent(
  input: ProjectAgentInput
): Promise<ProjectAgentRecord[]> {
  if (isTauriRuntime()) {
    return invoke<ProjectAgentRecord[]>("upsert_project_agent", { input });
  }
  return [];
}

export async function apiDeleteProjectAgent(
  projectPath: string,
  agentId: string
): Promise<ProjectAgentRecord[]> {
  if (isTauriRuntime()) {
    return invoke<ProjectAgentRecord[]>("delete_project_agent", {
      projectPath,
      agentId,
    });
  }
  return [];
}

export async function apiSeedProjectAgentsPreset(
  projectPath: string
): Promise<ProjectAgentRecord[]> {
  if (isTauriRuntime()) {
    return invoke<ProjectAgentRecord[]>("seed_project_agents_preset", {
      projectPath,
    });
  }
  return [];
}

export async function apiGetProjectBlackboard(
  projectPath: string
): Promise<string> {
  if (isTauriRuntime() && projectPath.trim()) {
    return invoke<string>("get_project_blackboard", { projectPath });
  }
  return "";
}

export async function apiSaveProjectBlackboard(
  projectPath: string,
  content: string
): Promise<void> {
  if (isTauriRuntime() && projectPath.trim()) {
    return invoke("save_project_blackboard", { projectPath, content });
  }
}

export async function apiSaveSessionHandoff(
  projectPath: string,
  filename: string,
  content: string
): Promise<string> {
  if (isTauriRuntime() && projectPath.trim()) {
    return invoke<string>("save_session_handoff", {
      projectPath,
      filename,
      content,
    });
  }
  return "";
}

export async function apiTrustProjectFolder(projectPath: string): Promise<void> {
  if (isTauriRuntime() && projectPath.trim()) {
    return invoke("trust_project_folder", { projectPath });
  }
}

export async function apiAnalyzeProjectWorkspace(
  projectPath: string
): Promise<ProjectAnalysisResult | null> {
  if (isTauriRuntime() && projectPath.trim()) {
    return invoke<ProjectAnalysisResult>("analyze_project_workspace", {
      projectPath,
    });
  }
  return null;
}

export async function apiGetProjectDeepContext(
  projectPath: string
): Promise<ProjectDeepContext | null> {
  if (isTauriRuntime() && projectPath.trim()) {
    return invoke<ProjectDeepContext>("get_project_deep_context", {
      projectPath,
    });
  }
  return null;
}

export async function apiGetDetectedCliCredentials(): Promise<DetectedCliCredential[]> {
  if (isTauriRuntime()) {
    return invoke<DetectedCliCredential[]>("get_detected_cli_credentials");
  }
  return [];
}

export async function apiRunCliDeepAnalysis(
  cliId: string,
  projectPath: string,
  prompt: string
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("run_cli_deep_analysis", {
      cliId,
      projectPath,
      prompt,
    });
  }
  return "";
}

export async function apiStartSession(
  cliId: string,
  cwd?: string,
  initialCommand?: string,
  agentId?: string
): Promise<SessionInfo> {
  if (isTauriRuntime()) {
    return invoke<SessionInfo>("start_session", {
      cliId,
      cwd: cwd ?? null,
      initialCommand: initialCommand ?? null,
      agentId: agentId ?? null,
    });
  }
  const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const banner = `\x1b[1;32m●\x1b[0m ${cliId} PTY Session Ready\r\n`;
  fallbackBuffers.set(id, banner);
  return {
    id,
    cliId,
    name: cliId,
    binaryPath: `${cliId}.exe`,
    cwd: cwd ?? "C:\\Workspace",
    status: "running",
    envInjected: [],
    startedAt: new Date().toISOString(),
  };
}

export async function apiWriteToSession(sessionId: string, data: string): Promise<void> {
  if (isTauriRuntime()) {
    return invoke("write_to_session", { sessionId, data });
  }
  const prev = fallbackBuffers.get(sessionId) ?? "";
  fallbackBuffers.set(sessionId, prev + data);
  fallbackListeners.forEach((cb) => cb({ sessionId, data }));
}

export async function apiResizeSession(
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> {
  if (isTauriRuntime()) {
    return invoke("resize_session", { sessionId, cols, rows });
  }
}

export async function apiReadSessionOutput(
  sessionId: string,
  cursor: number
): Promise<PtyOutputChunk> {
  if (isTauriRuntime()) {
    return invoke<PtyOutputChunk>("read_session_output", { sessionId, cursor });
  }
  const buf = fallbackBuffers.get(sessionId) ?? "";
  return {
    sessionId,
    data: buf.slice(cursor),
    nextCursor: buf.length,
  };
}

export async function apiStopSession(sessionId: string): Promise<void> {
  if (isTauriRuntime()) {
    return invoke("stop_session", { sessionId });
  }
  fallbackBuffers.delete(sessionId);
}

export async function apiListenPtyData(
  handler: (payload: { sessionId: string; data: string }) => void
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<{ sessionId: string; data: string }>("pty-data", (event) => {
      handler(event.payload);
    });
  }
  fallbackListeners.add(handler);
  return () => {
    fallbackListeners.delete(handler);
  };
}

export async function apiGetApiKeys(): Promise<ApiKeyStatus[]> {
  if (isTauriRuntime()) {
    return invoke<ApiKeyStatus[]>("get_api_keys");
  }
  return [];
}

export async function apiSaveApiKey(
  cliId: string,
  keyName: string,
  rawKey: string
): Promise<ApiKeyStatus> {
  if (isTauriRuntime()) {
    return invoke<ApiKeyStatus>("save_api_key", { cliId, keyName, rawKey });
  }
  return {
    cliId,
    keyName,
    hasKey: true,
    maskedPreview: "••••",
    updatedAt: new Date().toISOString(),
  };
}

export async function apiDeleteApiKey(cliId: string, keyName: string): Promise<void> {
  if (isTauriRuntime()) {
    return invoke("delete_api_key", { cliId, keyName });
  }
}

export async function apiSyncUsageLogs(
  cliFilter?: string,
  timeframe?: string
): Promise<UsageDashboardData> {
  if (isTauriRuntime()) {
    return invoke<UsageDashboardData>("sync_usage_logs", {
      cliFilter: cliFilter ?? null,
      timeframe: timeframe ?? null,
    });
  }
  return apiGetUsageDashboard(cliFilter, timeframe);
}

export async function apiGetUsageDashboard(
  cliFilter?: string,
  timeframe?: string
): Promise<UsageDashboardData> {
  if (isTauriRuntime()) {
    return invoke<UsageDashboardData>("get_usage_dashboard", {
      cliFilter: cliFilter ?? null,
      timeframe: timeframe ?? null,
    });
  }
  return {
    currentTokens: 0,
    rolling5hTokens: 0,
    rolling5hLimit: 500000,
    weeklyTokens: 0,
    weeklyLimit: 5000000,
    totalCostUsd: 0,
    estimatedSavedTokens: 0,
    recentLogsCount: 0,
    dailyHistory: [],
    modelBreakdown: [],
    cliSummaries: [],
    cliQuotas: [],
    activeQuota: null,
  };
}

export async function apiGetRegistryItems(): Promise<RegistryItem[]> {
  if (isTauriRuntime()) {
    return invoke<RegistryItem[]>("get_registry_items");
  }
  return [];
}

export async function apiScanLocalExtensions(): Promise<RegistryItem[]> {
  if (isTauriRuntime()) {
    return invoke<RegistryItem[]>("scan_local_extensions");
  }
  return [];
}

export async function apiToggleRegistryItem(
  itemId: string,
  enabled: boolean
): Promise<RegistryItem> {
  if (isTauriRuntime()) {
    return invoke<RegistryItem>("toggle_registry_item", { itemId, enabled });
  }
  throw new Error("Not in Tauri runtime");
}

export async function apiUpsertRegistryItem(params: {
  id: string;
  kind: string;
  name: string;
  description: string;
  configJson: string;
  appliedClis: string[];
}): Promise<RegistryItem> {
  if (isTauriRuntime()) {
    return invoke<RegistryItem>("upsert_registry_item", params);
  }
  throw new Error("Not in Tauri runtime");
}

export async function apiApplyItemToCli(
  itemId: string,
  cliId: string
): Promise<ApplyResult> {
  if (isTauriRuntime()) {
    return invoke<ApplyResult>("apply_item_to_cli", { itemId, cliId });
  }
  throw new Error("Not in Tauri runtime");
}

export async function apiGetConfigBackups(): Promise<BackupRecord[]> {
  if (isTauriRuntime()) {
    return invoke<BackupRecord[]>("get_config_backups");
  }
  return [];
}

export async function apiGetTeamMembers(): Promise<TeamMemberRecord[]> {
  if (isTauriRuntime()) {
    return invoke<TeamMemberRecord[]>("get_team_members");
  }
  return [];
}

export async function apiAddTeamMember(
  name: string,
  role: string,
  department: string,
  favoriteCli: string
): Promise<TeamMemberRecord[]> {
  if (isTauriRuntime()) {
    return invoke<TeamMemberRecord[]>("add_team_member", {
      name,
      role,
      department,
      favoriteCli,
    });
  }
  return [];
}

export async function apiDeleteTeamMember(memberId: string): Promise<TeamMemberRecord[]> {
  if (isTauriRuntime()) {
    return invoke<TeamMemberRecord[]>("delete_team_member", { memberId });
  }
  return [];
}

export async function apiWindowStartDragging(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("app_window_start_dragging");
  }
}

export async function apiWindowMinimize(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("app_window_minimize");
  }
}

export async function apiWindowToggleMaximize(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("app_window_toggle_maximize");
  }
}

export async function apiWindowClose(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("app_window_close");
  }
}

export async function apiWindowHide(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("app_window_hide");
  }
}

export async function apiWindowShow(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("app_window_show");
  }
}

export async function apiWindowExit(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("app_window_exit");
  }
}

export async function apiWindowIsMaximized(): Promise<boolean> {
  if (isTauriRuntime()) {
    return invoke<boolean>("app_window_is_maximized");
  }
  return false;
}

export interface AppUpdateInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_notes: string;
  release_url: string;
  download_url: string | null;
  published_at: string;
}

export async function apiCheckAppUpdate(): Promise<AppUpdateInfo> {
  if (isTauriRuntime()) {
    return invoke<AppUpdateInfo>("check_app_update");
  }
  return {
    current_version: "v1.0.0",
    latest_version: "v1.0.0",
    has_update: false,
    release_notes: "",
    release_url: "https://github.com/TodookGamja/AgentriX/releases",
    download_url: null,
    published_at: "",
  };
}

export async function apiResetAppData(): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>("reset_app_data");
  }
}

export async function apiSaveClipboardImage(
  base64Data: string,
  projectPath?: string,
  ext?: string
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("save_clipboard_image", {
      projectPath: projectPath || null,
      base64Data,
      ext: ext || "png",
    });
  }
  return "pasted_mock_image.png";
}

export async function apiOpenExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      await invoke("open_external_url", { url });
      return;
    } catch {}
  }
  window.open(url, "_blank");
}

export async function apiDownloadAndSaveUpdate(url: string, filename?: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("download_and_save_update", { url, filename });
  }
  window.open(url, "_blank");
  return "";
}
