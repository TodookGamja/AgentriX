import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  Blocks,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Columns2,
  Copy,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Grid2X2,
  Home,
  KeyRound,
  Maximize2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Rows2,
  Send,
  Sparkles,
  Square,
  Tag,
  Terminal,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useAppStore } from "./lib/store";
import {
  apiAddCustomCli,
  apiAddProjectFolder,
  apiAnalyzeProjectWorkspace,
  apiApplyItemToCli,
  apiAddTeamMember,
  apiDeleteApiKey,
  apiDeleteCustomCli,
  apiDeleteProjectAgent,
  apiDeleteProjectFolder,
  apiDeleteTeamMember,
  apiDetectClis,
  apiGetApiKeys,
  apiGetConfigBackups,
  apiGetProjectAgents,
  apiGetProjectBlackboard,
  apiGetProjectDeepContext,
  apiGetProjectFolders,
  apiGetRegistryItems,
  apiGetTeamMembers,
  apiGetUsageDashboard,
  apiSetAppThemeMode,
  apiSaveApiKey,
  apiSaveProjectBlackboard,
  apiSaveSessionHandoff,
  apiScanLocalExtensions,
  apiStartSession,
  apiStopSession,
  apiSyncUsageLogs,
  apiToggleRegistryItem,
  apiTrustProjectFolder,
  apiUpsertProjectAgent,
  apiUpsertRegistryItem,
  apiWriteToSession,
  apiWindowStartDragging,
  apiWindowMinimize,
  apiWindowToggleMaximize,
  apiWindowClose,
  apiWindowHide,
  apiWindowExit,
  apiWindowIsMaximized,
} from "./lib/tauriBridge";
import { listen } from "@tauri-apps/api/event";
import { TerminalPane } from "./components/TerminalPane";
import { ProjectWorkspaceView } from "./components/ProjectWorkspaceView";
import { UsageView } from "./components/UsageView";
import { McpSkillView } from "./components/McpSkillView";
import { AuthSettingsView } from "./components/AuthSettingsView";
import { TeamModeView } from "./components/TeamModeView";
import {
  TokenOptimizationModal,
  TokenOptimizationConfig,
} from "./components/TokenOptimizationModal";
import { AiDeepTeamModal } from "./components/AiDeepTeamModal";
import { FolderPickerModal } from "./components/FolderPickerModal";
import { AgentrixLogo } from "./components/AgentrixLogo";
import type {
  ActiveNavTab,
  CustomCliInput,
  ProjectAgentInput,
  ProjectAgentRecord,
  ProjectAnalysisResult,
  ProjectDeepContext,
  ProjectFolderRecord,
  UserProfile,
} from "./types/types";

export function getShortFolderName(pathStr?: string): string {
  if (!pathStr) return "기본폴더";
  return pathStr.split(/[/\\]/).filter(Boolean).pop() || pathStr;
}

const EMOJI_OPTIONS = ["👑", "🛠️", "🎨", "🔍", "🤖", "🦀", "🐍", "📊", "🛡️", "⚡"];

export const App: React.FC = () => {
  const {
    activeNav,
    clis,
    sessions,
    activeSessionId,
    apiKeys,
    usageDashboard,
    usageCliFilter,
    usageTimeframe,
    registryItems,
    backups,
    teamMembers,
    toast,
    setActiveNav,
    setClis,
    addSession,
    removeSession,
    setActiveSessionId,
    setApiKeys,
    setUsageDashboard,
    setUsageCliFilter,
    setUsageTimeframe,
    setRegistryItems,
    setBackups,
    setTeamMembers,
    showToast,
  } = useAppStore();

  // 좌측 패널 접기 상태
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 프로젝트 내부 서브 뷰: "overview" (프로젝트 홈 & 에이전트 추천/편성 화면) | "session" (실행 중인 CLI/에이전트 터미널 화면)
  const [projectSubView, setProjectSubView] = useState<"overview" | "session">("overview");

  // CLI 터미널 분할 레이아웃: "single" (단일) | "split-h" (좌우 2분할) | "split-v" (상하 2분할) | "grid-4" (4분할 2x2 그리드)
  const [splitLayout, setSplitLayout] = useState<"single" | "split-h" | "split-v" | "grid-4">("single");
  // 분할 각 슬롯(0~3)에 사용자가 직접 지정한 세션 ID들
  const [splitSlotSessionIds, setSplitSlotSessionIds] = useState<(string | null)[]>([null, null, null, null]);

  const handleAssignSessionToSlot = (slotIdx: number, sessionId: string) => {
    setSplitSlotSessionIds((prev) => {
      const next = [...prev];
      next[slotIdx] = sessionId;
      return next;
    });
  };

  // 1. 좌패널 프로젝트 목록 상태
  const [projectFolders, setProjectFolders] = useState<ProjectFolderRecord[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>(() => {
    try {
      return localStorage.getItem("agentrix_last_selected_project") || "";
    } catch {
      return "";
    }
  });
  const [showAddFolderInput, setShowAddFolderInput] = useState(false);
  const [manualFolderInput, setManualFolderInput] = useState("");

  // 프로젝트 목록 접기/펴기 상태
  const [projectListCollapsed, setProjectListCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("ai_cli_proj_list_collapsed") === "true";
  });

  // 프로젝트별 그룹 매핑 (projectPath -> groupName)
  const [projectGroups, setProjectGroups] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem("ai_cli_project_groups");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  // 그룹별 접기/펴기 상태 (groupName -> boolean)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("ai_cli_collapsed_groups");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  // 프로젝트 그룹 변경 모달 상태
  const [groupModalProjPath, setGroupModalProjPath] = useState<string | null>(null);
  const [targetGroupName, setTargetGroupName] = useState("");

  // 새 프로젝트 그룹 추가 모달 상태
  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  const [newGroupNameInput, setNewGroupNameInput] = useState("");
  const [selectedProjectForNewGroup, setSelectedProjectForNewGroup] = useState<string>("");
  const [customGroups, setCustomGroups] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("ai_cli_custom_groups");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const toggleProjectListCollapsed = () => {
    setProjectListCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("ai_cli_proj_list_collapsed", String(next));
      return next;
    });
  };

  const toggleGroupCollapsed = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [groupName]: !prev[groupName] };
      localStorage.setItem("ai_cli_collapsed_groups", JSON.stringify(next));
      return next;
    });
  };

  const handleSetProjectGroup = (projPath: string, groupName: string) => {
    setProjectGroups((prev) => {
      const next = { ...prev, [projPath]: groupName.trim() || "기본 프로젝트" };
      localStorage.setItem("ai_cli_project_groups", JSON.stringify(next));
      return next;
    });
    setGroupModalProjPath(null);
    showToast(`프로젝트가 '${groupName.trim() || "기본 프로젝트"}' 그룹으로 설정되었습니다.`, "info");
  };

  const handleCreateNewGroup = (name: string, targetProjPath?: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast("그룹 이름을 입력해주세요.", "info");
      return;
    }
    setCustomGroups((prev) => {
      if (!prev.includes(trimmed)) {
        const next = [...prev, trimmed];
        localStorage.setItem("ai_cli_custom_groups", JSON.stringify(next));
        return next;
      }
      return prev;
    });

    if (targetProjPath) {
      handleSetProjectGroup(targetProjPath, trimmed);
    } else {
      showToast(`'${trimmed}' 그룹이 생성되었습니다.`, "info");
    }
    setIsNewGroupModalOpen(false);
    setNewGroupNameInput("");
  };

  const handleDeleteGroup = (groupName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (groupName === "기본 프로젝트") return;
    setCustomGroups((prev) => {
      const next = prev.filter((g) => g !== groupName);
      localStorage.setItem("ai_cli_custom_groups", JSON.stringify(next));
      return next;
    });
    setProjectGroups((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(next)) {
        if (v === groupName) {
          next[k] = "기본 프로젝트";
        }
      }
      localStorage.setItem("ai_cli_project_groups", JSON.stringify(next));
      return next;
    });
    showToast(`'${groupName}' 그룹이 삭제되었습니다.`, "info");
  };

  const allGroupNames = useMemo(() => {
    const set = new Set<string>(["기본 프로젝트"]);
    for (const g of customGroups) {
      if (g && g.trim()) set.add(g.trim());
    }
    for (const g of Object.values(projectGroups)) {
      if (g && g.trim()) set.add(g.trim());
    }
    return Array.from(set);
  }, [customGroups, projectGroups]);

  const groupedProjects = useMemo(() => {
    const map = new Map<string, ProjectFolderRecord[]>();
    for (const g of allGroupNames) {
      map.set(g, []);
    }
    for (const proj of projectFolders) {
      const grp = projectGroups[proj.path] || "기본 프로젝트";
      if (!map.has(grp)) {
        map.set(grp, []);
      }
      map.get(grp)!.push(proj);
    }
    return map;
  }, [projectFolders, projectGroups, allGroupNames]);

  // 내 프로필 상태 (로컬 스토리지에 영속화)
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem("ai_cli_user_profile");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      name: "나 (내 프로필)",
      role: "Lead Architect & Developer",
      department: "Platform Engineering",
      favoriteCli: "claude",
      avatarEmoji: "👨‍💻",
    };
  });

  const handleUpdateUserProfile = (p: UserProfile) => {
    setUserProfile(p);
    try {
      localStorage.setItem("ai_cli_user_profile", JSON.stringify(p));
    } catch {}
    showToast("내 프로필이 업데이트되었습니다.", "success");
  };

  // 5. 테마 모드 상태 및 적용 (자동 / 다크 / 라이트)
  const [themeMode, setThemeMode] = useState<"auto" | "dark" | "light">(() => {
    try {
      const saved = localStorage.getItem("ai_cli_theme_mode");
      if (saved === "light" || saved === "dark" || saved === "auto") return saved;
    } catch {}
    return "dark";
  });

  const applyTheme = useCallback((mode: "auto" | "dark" | "light") => {
    const root = document.documentElement;
    if (mode === "light") {
      root.classList.remove("dark");
      root.classList.add("light");
    } else if (mode === "dark") {
      root.classList.remove("light");
      root.classList.add("dark");
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) {
        root.classList.remove("light");
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
        root.classList.add("light");
      }
    }
    const effectiveTheme =
      mode === "light"
        ? "light"
        : mode === "dark"
        ? "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    apiSetAppThemeMode(effectiveTheme).catch(() => {});
  }, []);

  const handleThemeChange = (mode: "auto" | "dark" | "light") => {
    setThemeMode(mode);
    try {
      localStorage.setItem("ai_cli_theme_mode", mode);
    } catch {}
    applyTheme(mode);
    showToast(`테마가 '${mode === "dark" ? "다크 모드" : mode === "light" ? "라이트 모드" : "시스템 자동"}'로 설정되었습니다.`, "info");
  };

  useEffect(() => {
    applyTheme(themeMode);
    if (themeMode === "auto") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = () => applyTheme("auto");
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }
  }, [themeMode, applyTheme]);

  // 2. 선택된 프로젝트 분석 결과(맞춤 추천 에이전트 포함) & 현재 영입된 에이전트 목록
  const [projectAnalysis, setProjectAnalysis] = useState<ProjectAnalysisResult | null>(null);
  const [projectAgents, setProjectAgents] = useState<ProjectAgentRecord[]>([]);

  // 프로젝트 폴더 선택 모달 상태 (앱 테마와 100% 일치하는 Agentrix 커스텀 폴더 브라우저)
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);

  // 커스텀 에이전트 생성/수정 모달 상태
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | undefined>(undefined);
  const [agentName, setAgentName] = useState("");
  const [agentRoleTitle, setAgentRoleTitle] = useState("");
  const [agentCliId, setAgentCliId] = useState("claude");
  const [agentUseWrapper, setAgentUseWrapper] = useState(true);
  const [agentEmoji, setAgentEmoji] = useState("🤖");
  const [agentColor, setAgentColor] = useState("#f97316");
  const [agentRolePrompt, setAgentRolePrompt] = useState("");
  const [agentAutoBrief, setAgentAutoBrief] = useState(true);

  // 프로젝트 공유 블랙보드(BLACKBOARD.md) 모달 상태
  const [showBlackboardModal, setShowBlackboardModal] = useState(false);
  const [blackboardContent, setBlackboardContent] = useState("");

  // 프로젝트 전체 에이전트 업무 하달 모달 상태
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchTaskText, setDispatchTaskText] = useState("");

  // AI 심층 팀빌딩 모달 상태
  const [showAiDeepModal, setShowAiDeepModal] = useState(false);
  const [projectDeepContext, setProjectDeepContext] = useState<ProjectDeepContext | null>(null);

  const handleOpenAiDeepModal = async () => {
    if (!selectedProjectPath) {
      showToast("먼저 프로젝트 폴더를 선택해 주세요.", "error");
      return;
    }
    try {
      const ctx = await apiGetProjectDeepContext(selectedProjectPath);
      setProjectDeepContext(ctx);
      setShowAiDeepModal(true);
    } catch (e: any) {
      showToast(`프로젝트 정보 로드 실패: ${e?.message || String(e)}`, "error");
    }
  };

  const handleApplyDeepAgents = (deepAgents: ProjectAgentInput[]) => {
    if (projectAnalysis) {
      setProjectAnalysis({
        ...projectAnalysis,
        summaryDescription: `✨ AI 심층 팀빌딩 완료: 연결된 AI 모델이 프로젝트 소스코드와 아키텍처를 면밀히 분석하여 ${deepAgents.length}명의 맞춤형 전담 에이전트 팀을 기획했습니다.`,
        recommendedAgents: deepAgents,
      });
    }
    showToast(`✨ AI 심층 기획 완료! ${deepAgents.length}명의 전문 에이전트 팀이 추천 목록에 반영되었습니다.`, "success");
  };

  // 토큰 최적화 및 스마트 자동 세션 릴레이(인수인계) 상태
  const [showTokenOptModal, setShowTokenOptModal] = useState(false);
  const [tokenOptConfig, setTokenOptConfig] = useState<TokenOptimizationConfig>(() => {
    try {
      const saved = localStorage.getItem("agentrix_token_opt_config");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      autoRelayEnabled: true,
      contextThresholdTokens: 100000,
      autoCompactFirst: true,
      syncToBlackboard: true,
      preserveRolePrompt: true,
      closeOldSession: true,
    };
  });

  const [sessionTokens, setSessionTokens] = useState<Record<string, number>>({});
  const sessionRecentOutputRef = useRef<Record<string, string>>({});
  const relayedSessionsRef = useRef<Set<string>>(new Set());
  const compactAttemptedRef = useRef<Set<string>>(new Set());

  const handleSaveTokenOptConfig = (cfg: TokenOptimizationConfig) => {
    setTokenOptConfig(cfg);
    try {
      localStorage.setItem("agentrix_token_opt_config", JSON.stringify(cfg));
    } catch {}
    showToast(
      "⚡ 토큰 최적화 및 스마트 자동 릴레이 설정이 저장되었습니다.",
      "success"
    );
  };

  const refreshAll = useCallback(async () => {
    const results = await Promise.allSettled([
      apiDetectClis(),
      apiGetApiKeys(),
      apiGetUsageDashboard(usageCliFilter, usageTimeframe),
      apiGetRegistryItems(),
      apiGetConfigBackups(),
      apiGetTeamMembers(),
      apiGetProjectFolders(),
    ]);

    if (results[0].status === "fulfilled") setClis(results[0].value);
    if (results[1].status === "fulfilled") setApiKeys(results[1].value);
    if (results[2].status === "fulfilled") setUsageDashboard(results[2].value);
    if (results[3].status === "fulfilled") setRegistryItems(results[3].value);
    if (results[4].status === "fulfilled") setBackups(results[4].value);
    if (results[5].status === "fulfilled") setTeamMembers(results[5].value);
    if (results[6].status === "fulfilled") {
      const folders = results[6].value;
      setProjectFolders(folders);
      setSelectedProjectPath((prev) => {
        if (prev && folders.some((f) => f.path === prev)) return prev;
        try {
          const saved = localStorage.getItem("agentrix_last_selected_project");
          if (saved && folders.some((f) => f.path === saved)) return saved;
        } catch {}
        return folders[0]?.path || "";
      });
    }
  }, [
    usageCliFilter,
    usageTimeframe,
    setClis,
    setApiKeys,
    setUsageDashboard,
    setRegistryItems,
    setBackups,
    setTeamMembers,
  ]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // 선택된 프로젝트가 바뀔 때마다 프로젝트 기술스택 분석(추천 에이전트 생성) 및 배정된 에이전트 목록 로드
  useEffect(() => {
    if (!selectedProjectPath) {
      setProjectAgents([]);
      setProjectAnalysis(null);
      return;
    }
    apiGetProjectAgents(selectedProjectPath)
      .then(setProjectAgents)
      .catch(() => setProjectAgents([]));

    apiAnalyzeProjectWorkspace(selectedProjectPath)
      .then(setProjectAnalysis)
      .catch(() => setProjectAnalysis(null));
  }, [selectedProjectPath]);

  // 현재 선택된 프로젝트의 세션들만 표시
  const currentProjectSessions = useMemo(
    () => sessions.filter((s) => s.cwd === selectedProjectPath),
    [sessions, selectedProjectPath]
  );

  // 분할 모드에 따른 표시 슬롯 개수
  const visibleSlotCount =
    splitLayout === "single" ? 1 : splitLayout === "grid-4" ? 4 : 2;

  // 각 분할 슬롯(0~3)에 할당될 실제 세션 계산
  // 중요: 분할 화면 모드에서는 슬롯 0, 1, 2, 3의 화면 배치를 완전히 고정하여,
  // 포커스가 이동하더라도 다른 화면이 1번 슬롯으로 이동하는 자리바꿈 현상을 원천 방지합니다.
  const resolvedPaneSessions = useMemo(() => {
    // 단일 모드일 때는 현재 활성화된 세션을 전체 화면에 표시
    if (splitLayout === "single") {
      const active =
        sessions.find((s) => s.id === activeSessionId) ||
        currentProjectSessions[0] ||
        sessions[0] ||
        null;
      return [active, null, null, null];
    }

    // 분할 모드일 때: 슬롯 0, 1, 2, 3의 고정 배치 유지 (포커스 이동에 영향받지 않음)
    const assigned: (typeof sessions[0] | null)[] = [];
    const usedIds = new Set<string>();

    for (let slot = 0; slot < 4; slot++) {
      const preferredId = splitSlotSessionIds[slot];
      const preferred = preferredId
        ? sessions.find((s) => s.id === preferredId && !usedIds.has(s.id))
        : null;

      if (preferred) {
        assigned.push(preferred);
        usedIds.add(preferred.id);
      } else {
        const candidate =
          currentProjectSessions.find((s) => !usedIds.has(s.id)) ||
          sessions.find((s) => !usedIds.has(s.id)) ||
          null;
        if (candidate) {
          assigned.push(candidate);
          usedIds.add(candidate.id);
        } else {
          assigned.push(null);
        }
      }
    }
    return assigned;
  }, [sessions, currentProjectSessions, splitLayout, splitSlotSessionIds, activeSessionId]);

  // 좌패널에서 프로젝트를 클릭하면 -> CLI가 바로 뜨는 게 아니라 해당 프로젝트 전용 화면(ProjectWorkspaceView)이 뜸!
  const handleSelectProject = (path: string) => {
    setSelectedProjectPath(path);
    try {
      localStorage.setItem("agentrix_last_selected_project", path);
    } catch {}
    setActiveNav("terminal");
    setProjectSubView("overview");
  };

  // 프로젝트 화면에서 추천 에이전트 1명 영입(추가)
  const handleAddRecommendedAgent = async (rec: ProjectAgentInput) => {
    if (!selectedProjectPath) return;
    try {
      const updated = await apiUpsertProjectAgent({
        ...rec,
        projectPath: selectedProjectPath,
      });
      setProjectAgents(updated);
      showToast(
        `[${getShortFolderName(selectedProjectPath)}] 프로젝트에 ${rec.avatarEmoji} ${rec.name} (${rec.roleTitle}) 에이전트를 영입했습니다!`,
        "success"
      );
    } catch (err) {
      showToast(`에이전트 영입 실패: ${String(err)}`, "error");
    }
  };

  // 프로젝트 화면에서 추천 에이전트 전체 일괄 영입
  const handleAddAllRecommended = async (recs: ProjectAgentInput[]) => {
    if (!selectedProjectPath || recs.length === 0) return;
    try {
      let latest = projectAgents;
      for (const rec of recs) {
        latest = await apiUpsertProjectAgent({
          ...rec,
          projectPath: selectedProjectPath,
        });
      }
      setProjectAgents(latest);
      showToast(
        `[${getShortFolderName(selectedProjectPath)}] 추천 에이전트 ${recs.length}명을 모두 프로젝트에 영입했습니다!`,
        "success"
      );
    } catch (err) {
      showToast(`일괄 영입 실패: ${String(err)}`, "error");
    }
  };

  // 일반 CLI 세션 시작 (현재 선택된 프로젝트 폴더 기준)
  const handleStartRawCliSession = async (
    cliId: string,
    initialCommand?: string,
    customCwd?: string
  ) => {
    const targetCwd = customCwd || selectedProjectPath;
    if (!targetCwd) {
      showToast("좌측 패널에서 먼저 프로젝트를 선택하거나 추가해 주세요.", "error");
      return;
    }
    try {
      const session = await apiStartSession(cliId, targetCwd, initialCommand);
      addSession(session);
      setActiveNav("terminal");
      setProjectSubView("session");
      const folderShort = getShortFolderName(session.cwd);
      showToast(
        `[${folderShort}] 프로젝트에서 ${session.name} 세션이 시작되었습니다.`,
        "success"
      );
    } catch (err) {
      showToast(`세션 시작 실패: ${String(err)}`, "error");
    }
  };

  // 프로젝트 전담 에이전트 출근(실행) -> 터미널 뷰로 전환
  const handleSpawnAgentSession = async (agent: ProjectAgentRecord) => {
    const cliDef = clis.find((c) => c.id === agent.cliId);
    const initialCmd =
      agent.useWrapper && cliDef?.wrapperBinary ? "__WRAPPER__" : undefined;

    try {
      const session = await apiStartSession(
        agent.cliId,
        agent.projectPath,
        initialCmd,
        agent.id
      );
      addSession(session);
      setActiveNav("terminal");
      setProjectSubView("session");

      const folderShort = getShortFolderName(agent.projectPath);
      showToast(
        `[${folderShort}] ${agent.avatarEmoji} ${agent.name} (${agent.roleTitle}) 에이전트가 출근했습니다!`,
        "success"
      );

      if (agent.autoBrief && agent.rolePrompt.trim()) {
        window.setTimeout(() => {
          const cleanPrompt = agent.rolePrompt.replace(/[\r\n]+/g, " ").trim();
          const briefing = `${cleanPrompt}\r\n`;
          apiWriteToSession(session.id, briefing).catch(() => {});
        }, 3200);
      }
    } catch (err) {
      showToast(`에이전트 실행 실패: ${String(err)}`, "error");
    }
  };

  // 현재 프로젝트의 모든 에이전트 일괄 출근 (동시 파일 락 경합 방지용 450ms 지연 적용)
  const handleSpawnAllProjectAgents = async () => {
    if (projectAgents.length === 0) return;
    for (const agent of projectAgents) {
      const alreadyRunning = currentProjectSessions.some(
        (s) => s.agentId === agent.id
      );
      if (!alreadyRunning) {
        await handleSpawnAgentSession(agent);
        await new Promise((r) => setTimeout(r, 450));
      }
    }
  };

  // 사용자 확인 없는 완전 자율 협업 파이프라인 가동
  const handleStartAutonomousCollaboration = async () => {
    if (projectAgents.length === 0) {
      showToast("먼저 배정할 에이전트를 추가해 주세요.", "error");
      return;
    }

    await handleSpawnAllProjectAgents();

    const autoMemo = `\n\n## [⚡ 무인 자율 협업 파이프라인 가동 - ${new Date().toLocaleTimeString()}]\n- 모드: 완전 자율 연동 (사용자 승인 질문 없이 즉시 수행)\n- 지침: 총괄 PM은 프로젝트의 현재 구조를 점검하여 즉시 구현/수정 태스크를 분해하고, 각 도메인 에이전트(백엔드/프론트엔드/QA)에게 할당하세요. 각 에이전트는 담당 파트를 직접 구현한 후 결과를 이 메모장에 남기고 다음 에이전트에게 인수인계하세요.\n`;
    try {
      const cur = await apiGetProjectBlackboard(selectedProjectPath);
      await apiSaveProjectBlackboard(selectedProjectPath, cur + autoMemo);
    } catch {}

    const pmSession =
      currentProjectSessions.find(
        (s) =>
          s.name.includes("PM") ||
          s.agentRole?.includes("PM") ||
          s.agentRole?.includes("리더")
      ) || currentProjectSessions[0];

    if (pmSession) {
      setTimeout(() => {
        apiWriteToSession(
          pmSession.id,
          "프로젝트 무인 자율 협업 파이프라인이 가동되었습니다. .ai-agents/BLACKBOARD.md의 요구사항을 읽고 하위 작업을 분해하여 각 에이전트에게 할당하고 작업을 시작하세요.\r"
        ).catch(() => {});
      }, 2000);
    }

    showToast(
      "⚡ 무인 자율 협업 파이프라인 가동! 사용자 승인 없이 에이전트 간 업무가 연속 연동됩니다.",
      "success"
    );
  };

  const handleToggleAgentWrapper = async (agent: ProjectAgentRecord) => {
    const payload: ProjectAgentInput = {
      id: agent.id,
      projectPath: agent.projectPath,
      name: agent.name,
      roleTitle: agent.roleTitle,
      cliId: agent.cliId,
      useWrapper: !agent.useWrapper,
      avatarEmoji: agent.avatarEmoji,
      accentColor: agent.accentColor,
      rolePrompt: agent.rolePrompt,
      autoBrief: agent.autoBrief,
    };
    try {
      const updated = await apiUpsertProjectAgent(payload);
      setProjectAgents(updated);
      showToast(
        `'${agent.name}' 에이전트의 Headroom 래퍼가 ${!agent.useWrapper ? "활성화(ON)" : "해제(OFF)"}되었습니다.`,
        "info"
      );
    } catch (err) {
      showToast(`Headroom 상태 변경 실패: ${String(err)}`, "error");
    }
  };

  // 토큰 초과 시 또는 수동 요청 시 스마트 자동 세션 릴레이(인수인계) 실행
  const handleAutoRelaySession = async (sessionId: string, isManual = false) => {
    const targetSession = sessions.find((s) => s.id === sessionId);
    if (!targetSession) return;

    // 1. autoCompactFirst가 켜져 있고 수동이 아니며 아직 1차 /compact를 시도하지 않았다면:
    if (!isManual && tokenOptConfig.autoCompactFirst && !compactAttemptedRef.current.has(sessionId)) {
      compactAttemptedRef.current.add(sessionId);
      showToast(
        `⚡ [토큰 최적화] '${targetSession.name}' 컨텍스트 임계치 도달: 1차 /compact 압축을 실행합니다. (압축 후에도 초과 시 새 세션으로 자동 인수인계)`,
        "info"
      );
      try {
        await apiWriteToSession(sessionId, "\r/compact\r");
      } catch {}
      // 1차 컴팩트 실행 후 토큰 수치를 가상으로 50% 수준으로 조정하여 사용자가 계속 진행할 수 있게 함
      setSessionTokens((prev) => ({
        ...prev,
        [sessionId]: Math.round(tokenOptConfig.contextThresholdTokens * 0.5),
      }));
      return; // 새 세션을 열지 않고 1차 압축 효과를 유지함
    }

    // 2. 컴팩트 1회 후에도 다시 임계치를 초과했거나 수동으로 릴레이를 실행한 경우:
    if (!isManual && relayedSessionsRef.current.has(sessionId)) return;
    relayedSessionsRef.current.add(sessionId);

    // 인수인계 md 파일 내용 생성
    const matchedAgent = projectAgents.find((a) => a.id === targetSession.agentId);
    const agentName = matchedAgent?.name || targetSession.name;
    const agentRole = matchedAgent?.roleTitle || targetSession.agentRole || "전담 엔지니어";
    const recentSnippet = (sessionRecentOutputRef.current[sessionId] || "")
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      .trim()
      .slice(-1400);

    const relayMatch = targetSession.name.match(/릴레이\s*(\d+)/);
    const relayCount = relayMatch ? parseInt(relayMatch[1], 10) + 1 : 1;
    const baseName = targetSession.name.replace(/\s*\(릴레이.*?\)/, "").trim();
    const newSessionName = `${baseName} (릴레이 ${relayCount})`;

    const handoffMarkdown = `# ⚡ [AgentriX 스마트 세션 인수인계 리포트 (Session Handoff #${relayCount})]
- **생성 일시**: ${new Date().toLocaleString("ko-KR")}
- **발신 세션**: \`${targetSession.name}\` (컴팩트 1회 완료 후 컨텍스트 한도 도달)
- **담당 에이전트**: ${agentName} (${agentRole})
- **프로젝트 작업 디렉토리**: \`${targetSession.cwd}\`

---

## 📋 직전 세션 최근 진행 요약 및 터미널 출력
\`\`\`
${recentSnippet || "진행 내역 기록 없음"}
\`\`\`

---

## 🎯 신규 세션 연속 작업 지침
1. 위 작업 로그와 현재 프로젝트 파일 구조를 확인하세요.
2. 직전 세션에서 진행 중이던 중단점부터 작업을 지체 없이 이어서 수행하세요.
3. 작업 완료 또는 주요 진척 사항은 .ai-agents/BLACKBOARD.md 에 기록하세요.
`;

    // 3. md 파일로 인수인계 저장 (.ai-agents/SESSION_HANDOFF.md & BLACKBOARD.md)
    if (targetSession.cwd) {
      try {
        await apiSaveSessionHandoff(targetSession.cwd, "SESSION_HANDOFF.md", handoffMarkdown);
        if (tokenOptConfig.syncToBlackboard) {
          const existingBb = (await apiGetProjectBlackboard(targetSession.cwd)) || "";
          const handoffLog = `\n\n### ⚡ [스마트 세션 자동 인수인계 (Relay #${relayCount})] - ${new Date().toLocaleString("ko-KR")}\n` +
            `- **이전 세션**: \`${targetSession.name}\` (누적 추정 토큰 한도 도달 -> 프로세스 정리 완료)\n` +
            `- **담당 에이전트**: ${agentName} (${agentRole})\n` +
            `- **인수인계 파일**: \`.ai-agents/SESSION_HANDOFF.md\`\n` +
            `- **연속 작업 지침**: 신규 세션에서 인수인계 파일을 읽고 중단점부터 이어서 작업을 완수하세요.\n`;
          await apiSaveProjectBlackboard(targetSession.cwd, existingBb + handoffLog);
        }
      } catch (e) {
        console.error("Handoff file save error:", e);
      }
    }

    // 4. 신규 세션 생성 및 슬롯 배치 교체
    try {
      const cliDef = clis.find((c) => c.id === targetSession.cliId);
      const initialCmd =
        targetSession.binaryPath.includes("Headroom Wrapper") && cliDef?.wrapperBinary
          ? "__WRAPPER__"
          : undefined;

      const newSession = await apiStartSession(
        targetSession.cliId,
        targetSession.cwd,
        initialCmd,
        targetSession.agentId || undefined
      );

      newSession.name = newSessionName;
      if (tokenOptConfig.preserveRolePrompt && targetSession.rolePrompt) {
        newSession.rolePrompt = targetSession.rolePrompt;
        newSession.agentRole = targetSession.agentRole;
      }

      addSession(newSession);
      setActiveSessionId(newSession.id);
      setActiveNav("terminal");
      setProjectSubView("session");

      // 화면 분할 슬롯에 이전 세션이 등록되어 있었다면 새 세션 ID로 자동 교체
      setSplitSlotSessionIds((prev) =>
        prev.map((sid) => (sid === targetSession.id ? newSession.id : sid))
      );

      // 5. 새 세션에 md 파일 읽기 및 연속 작업 지침 자동 주입
      setTimeout(async () => {
        try {
          const handoffPrompt = `.ai-agents/SESSION_HANDOFF.md 파일을 확인하고 직전 세션에서 진행하던 작업을 이어서 완료해 주세요.\r`;
          await apiWriteToSession(newSession.id, handoffPrompt);
        } catch {}
      }, 600);

      // 6. 🔥 핵심: 기존 세션 즉시 완전 종료 및 PC 메모리/자원 회수!
      if (tokenOptConfig.closeOldSession ?? true) {
        setTimeout(async () => {
          try {
            await apiStopSession(targetSession.id);
          } catch {}
          removeSession(targetSession.id);
          setSessionTokens((prev) => {
            const next = { ...prev };
            delete next[targetSession.id];
            return next;
          });
          delete sessionRecentOutputRef.current[targetSession.id];
          compactAttemptedRef.current.delete(targetSession.id);
          relayedSessionsRef.current.delete(targetSession.id);
        }, 1200);

        showToast(
          `⚡ [토큰 최적화 완료] '${targetSession.name}' 작업이 md 파일로 전달되고 신규 세션으로 교체되었습니다. (구 세션 프로세스 자동 종료 완료)`,
          "success"
        );
      } else {
        showToast(
          `⚡ [토큰 최적화 완료] '${targetSession.name}' -> '${newSession.name}' 자동 인수인계 전환되었습니다!`,
          "success"
        );
      }
    } catch (err: any) {
      showToast(`릴레이 세션 생성 실패: ${err?.message || String(err)}`, "error");
    }
  };

  // 실시간 PTY 청크 수신 시 토큰 추정 및 자동 임계치 감지
  const handleSessionOutputChunk = (sessionId: string, text: string) => {
    const estAddTokens = Math.max(1, Math.round(text.length / 3.8));
    let nextTotal = 0;
    setSessionTokens((prev) => {
      nextTotal = (prev[sessionId] || 0) + estAddTokens;
      return { ...prev, [sessionId]: nextTotal };
    });

    const prevLog = sessionRecentOutputRef.current[sessionId] || "";
    sessionRecentOutputRef.current[sessionId] = (prevLog + text).slice(-3000);

    if (
      tokenOptConfig.autoRelayEnabled &&
      nextTotal >= tokenOptConfig.contextThresholdTokens &&
      !relayedSessionsRef.current.has(sessionId)
    ) {
      handleAutoRelaySession(sessionId, false);
    }
  };

  const handleToggleAllAgentsWrapper = async (enable: boolean) => {
    if (!selectedProjectPath || projectAgents.length === 0) return;
    try {
      for (const agent of projectAgents) {
        if (agent.useWrapper !== enable) {
          await apiUpsertProjectAgent({
            id: agent.id,
            projectPath: agent.projectPath,
            name: agent.name,
            roleTitle: agent.roleTitle,
            cliId: agent.cliId,
            useWrapper: enable,
            avatarEmoji: agent.avatarEmoji,
            accentColor: agent.accentColor,
            rolePrompt: agent.rolePrompt,
            autoBrief: agent.autoBrief,
          });
        }
      }
      const refreshed = await apiGetProjectAgents(selectedProjectPath);
      setProjectAgents(refreshed);
      showToast(
        `모든 에이전트의 Headroom 토큰 감싸기가 ${enable ? "일괄 활성화(ON)" : "일괄 해제(OFF)"}되었습니다.`,
        "success"
      );
    } catch (err) {
      showToast(`전체 Headroom 변경 실패: ${String(err)}`, "error");
    }
  };

  const handleSendPromptToAgent = async (agentId: string, prompt: string) => {
    const session = sessions.find((s) => s.agentId === agentId);
    if (!session) {
      showToast("해당 에이전트의 실행 중인 세션을 찾을 수 없습니다. 먼저 실행해 주세요.", "error");
      return;
    }
    await apiWriteToSession(session.id, prompt);
    showToast("에이전트에게 지시를 전달했습니다.", "success");
  };

  const handleStartAutonomousRelayWithGoal = async (goal: string) => {
    if (projectAgents.length === 0) {
      showToast("먼저 배정할 에이전트를 추가해 주세요.", "error");
      return;
    }

    await handleSpawnAllProjectAgents();

    const autoMemo = `\n\n## [⚡ 무인 자율 협업 가동 - ${new Date().toLocaleTimeString()}]\n- 사용자 목표: ${goal}\n- 실행 권한 모드: 완전 자동 승인 (--yolo / Full-Auto, 승인 질문 일체 생략)\n- 총괄 PM 지침: 목표를 분석하여 하위 작업을 세분화하고, .ai-agents/BLACKBOARD.md를 통해 백엔드(Rust), 프론트엔드(UI), QA 에이전트에게 업무를 인수인계하세요. 구현 완료 후 최종 결과를 사용자에게 보고하세요.\n`;
    try {
      const cur = await apiGetProjectBlackboard(selectedProjectPath);
      await apiSaveProjectBlackboard(selectedProjectPath, cur + autoMemo);
    } catch {}

    setTimeout(() => {
      const pmSession =
        sessions.find(
          (s) =>
            s.cwd === selectedProjectPath &&
            (s.name.includes("PM") ||
              s.agentRole?.includes("PM") ||
              s.agentRole?.includes("리더"))
        ) || sessions.find((s) => s.cwd === selectedProjectPath);

      if (pmSession) {
        const pmDirective = `[무인 자율 협업 오케스트레이션 지침] 사용자 목표: "${goal.replace(/[\r\n]+/g, " ")}". 당신은 총괄 PM 리더입니다. 요구사항을 분석하여 .ai-agents/BLACKBOARD.md에 설계 결정을 남기고, 각 도메인 에이전트에게 작업을 순차 전달하세요. 사용자는 당신의 보고만을 기다립니다. 즉시 작업을 시작하세요.\r\n`;
        apiWriteToSession(pmSession.id, pmDirective).catch(() => {});
      }
    }, 2000);

    showToast(
      `🚀 총괄 PM에게 목표가 전달되었으며, 무인 자율 협업이 시작되었습니다!`,
      "success"
    );
  };

  const handleTrustProjectFolder = async () => {
    if (!selectedProjectPath) return;
    try {
      await apiTrustProjectFolder(selectedProjectPath);
      showToast(
        `[${getShortFolderName(selectedProjectPath)}] 폴더가 신뢰 목록에 등록되었습니다. 이제 폴더 신뢰 질문 없이 바로 실행됩니다.`,
        "success"
      );
    } catch (err) {
      showToast(`폴더 신뢰 등록 실패: ${String(err)}`, "error");
    }
  };

  const handleAddTeamMember = async (name: string, role: string, dept: string, cli: string) => {
    try {
      const updated = await apiAddTeamMember(name, role, dept, cli);
      setTeamMembers(updated);
      showToast(`'${name}' 팀원이 성공적으로 등록되었습니다.`, "success");
    } catch (err) {
      showToast(`팀원 추가 실패: ${String(err)}`, "error");
    }
  };

  const handleDeleteTeamMember = async (memberId: string) => {
    try {
      const updated = await apiDeleteTeamMember(memberId);
      setTeamMembers(updated);
      showToast("팀원이 목록에서 삭제되었습니다.", "info");
    } catch (err) {
      showToast(`팀원 삭제 실패: ${String(err)}`, "error");
    }
  };

  const openCreateAgentModal = () => {
    setEditingAgentId(undefined);
    setAgentName("");
    setAgentRoleTitle("");
    setAgentCliId("claude");
    setAgentUseWrapper(true);
    setAgentEmoji("🤖");
    setAgentColor("#6366f1");
    setAgentRolePrompt(
      `당신은 '${getShortFolderName(
        selectedProjectPath
      )}' 프로젝트의 전담 에이전트입니다. 맡은 역할에 집중하여 코드를 분석·구현하고 핵심 결정사항을 .ai-agents/BLACKBOARD.md에 공유하세요.`
    );
    setAgentAutoBrief(true);
    setShowAgentModal(true);
  };

  const openEditAgentModal = (agent: ProjectAgentRecord) => {
    setEditingAgentId(agent.id);
    setAgentName(agent.name);
    setAgentRoleTitle(agent.roleTitle);
    setAgentCliId(agent.cliId);
    setAgentUseWrapper(agent.useWrapper);
    setAgentEmoji(agent.avatarEmoji);
    setAgentColor(agent.accentColor);
    setAgentRolePrompt(agent.rolePrompt);
    setAgentAutoBrief(agent.autoBrief);
    setShowAgentModal(true);
  };

  const handleSaveProjectAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectPath) return;
    const payload: ProjectAgentInput = {
      id: editingAgentId,
      projectPath: selectedProjectPath,
      name: agentName.trim(),
      roleTitle: agentRoleTitle.trim(),
      cliId: agentCliId,
      useWrapper: agentUseWrapper,
      avatarEmoji: agentEmoji,
      accentColor: agentColor,
      rolePrompt: agentRolePrompt.trim(),
      autoBrief: agentAutoBrief,
    };
    try {
      const updated = await apiUpsertProjectAgent(payload);
      setProjectAgents(updated);
      setShowAgentModal(false);
      showToast(
        `[${getShortFolderName(selectedProjectPath)}] 프로젝트에 '${payload.name}' 에이전트가 저장되었습니다.`,
        "success"
      );
    } catch (err) {
      showToast(`에이전트 저장 실패: ${String(err)}`, "error");
    }
  };

  const handleDeleteProjectAgent = async (agentId: string) => {
    if (!selectedProjectPath) return;
    try {
      const updated = await apiDeleteProjectAgent(selectedProjectPath, agentId);
      setProjectAgents(updated);
      showToast("해당 프로젝트에서 에이전트가 제외되었습니다.", "info");
    } catch (err) {
      showToast(`에이전트 삭제 오류: ${String(err)}`, "error");
    }
  };

  const handleOpenBlackboard = async () => {
    if (!selectedProjectPath) return;
    try {
      const content = await apiGetProjectBlackboard(selectedProjectPath);
      setBlackboardContent(content);
      setShowBlackboardModal(true);
    } catch (err) {
      showToast(`블랙보드 로드 실패: ${String(err)}`, "error");
    }
  };

  const handleSaveBlackboard = async () => {
    if (!selectedProjectPath) return;
    try {
      await apiSaveProjectBlackboard(selectedProjectPath, blackboardContent);
      setShowBlackboardModal(false);
      showToast(
        `[${getShortFolderName(selectedProjectPath)}] 프로젝트 공유 블랙보드(.ai-agents/BLACKBOARD.md)가 저장되었습니다.`,
        "success"
      );
    } catch (err) {
      showToast(`블랙보드 저장 실패: ${String(err)}`, "error");
    }
  };

  // 프로젝트 추가 버튼: 테마가 100% 동기화된 Agentrix 전용 폴더 브라우저 모달 오픈
  const handleBrowseNativeFolder = () => {
    setIsFolderPickerOpen(true);
  };

  const handleFolderPickerSelect = async (picked: string) => {
    try {
      const folders = await apiAddProjectFolder(picked);
      setProjectFolders(folders);
      setSelectedProjectPath(picked);
      setActiveNav("terminal");
      setProjectSubView("overview");
      showToast(
        `프로젝트 추가 완료: [${getShortFolderName(picked)}] 프로젝트 화면으로 이동합니다.`,
        "success"
      );
    } catch (err) {
      showToast(`프로젝트 추가 실패: ${String(err)}`, "error");
    }
  };

  const handleAddManualFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualFolderInput.trim()) return;
    try {
      const target = manualFolderInput.trim();
      const updated = await apiAddProjectFolder(target);
      setProjectFolders(updated);
      setSelectedProjectPath(target);
      setActiveNav("terminal");
      setProjectSubView("overview");
      setManualFolderInput("");
      setShowAddFolderInput(false);
      showToast("프로젝트 폴더가 등록되었습니다.", "success");
    } catch (err) {
      showToast(`폴더 등록 오류: ${String(err)}`, "error");
    }
  };

  const handleRemoveProjectFolder = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await apiDeleteProjectFolder(path);
      setProjectFolders(updated);
      if (selectedProjectPath === path) {
        setSelectedProjectPath(updated[0]?.path ?? "");
        setProjectSubView("overview");
      }
    } catch (err) {
      showToast(`폴더 삭제 실패: ${String(err)}`, "error");
    }
  };

  const handleStopSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiStopSession(sessionId);
      removeSession(sessionId);
      const remaining = currentProjectSessions.filter((s) => s.id !== sessionId);
      if (remaining.length === 0) {
        setProjectSubView("overview");
      }
      showToast("세션이 종료되었습니다.", "info");
    } catch (err) {
      showToast(`세션 종료 오류: ${String(err)}`, "error");
    }
  };

  const handleBroadcastPrompt = async (text: string) => {
    const targets = (
      splitLayout === "single"
        ? [activeSessionId]
        : resolvedPaneSessions.slice(0, visibleSlotCount).map((s) => s?.id)
    ).filter((id): id is string => Boolean(id));

    await Promise.all(targets.map((id) => apiWriteToSession(id, text)));
  };

  const handleBroadcastToProject = async (projectPath: string, text: string) => {
    const targets = sessions.filter((s) => s.cwd === projectPath);
    if (targets.length === 0) {
      showToast("현재 이 프로젝트에 실행 중인 에이전트 세션이 없습니다.", "error");
      return;
    }
    await Promise.all(targets.map((s) => apiWriteToSession(s.id, text)));
    showToast(
      `[${getShortFolderName(projectPath)}] 프로젝트의 ${targets.length}개 에이전트에게 동시 지시를 전달했습니다.`,
      "success"
    );
  };

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchTaskText.trim() || !selectedProjectPath) return;
    await handleBroadcastToProject(
      selectedProjectPath,
      `${dispatchTaskText.trim()}\r`
    );
    setDispatchTaskText("");
    setShowDispatchModal(false);
  };

  const handleFilterChange = async (filter: string) => {
    setUsageCliFilter(filter);
    const data = await apiGetUsageDashboard(filter, usageTimeframe);
    setUsageDashboard(data);
  };

  const handleTimeframeChange = async (timeframe: string) => {
    setUsageTimeframe(timeframe);
    const data = await apiGetUsageDashboard(usageCliFilter, timeframe);
    setUsageDashboard(data);
  };

  const handleSyncUsage = async (timeframeOverride?: string) => {
    try {
      const tf = timeframeOverride || usageTimeframe;
      const data = await apiSyncUsageLogs(usageCliFilter, tf);
      setUsageDashboard(data);
      const team = await apiGetTeamMembers();
      setTeamMembers(team);
      showToast("사용량 및 구독 쿼터가 갱신되었습니다.", "success");
    } catch (err) {
      showToast(`한도 로그 새로고침 실패: ${String(err)}`, "error");
    }
  };

  const handleRefreshTeam = async () => {
    try {
      const team = await apiGetTeamMembers();
      setTeamMembers(team);
      const usage = await apiGetUsageDashboard(usageCliFilter, usageTimeframe);
      setUsageDashboard(usage);
      showToast("팀 뷰 및 토큰 정보가 즉시 동기화되었습니다.", "success");
    } catch (err) {
      showToast(`팀 뷰 동기화 실패: ${String(err)}`, "error");
    }
  };

  const myUsage = useMemo(() => {
    return {
      rolling5h: usageDashboard?.rolling5hTokens ?? 0,
      weekly: usageDashboard?.weeklyTokens ?? 0,
      savedPct: 35.0,
      costUsd: usageDashboard?.totalCostUsd ?? 0.0,
    };
  }, [usageDashboard]);

  const handleToggleRegistry = async (itemId: string, enabled: boolean) => {
    await apiToggleRegistryItem(itemId, enabled);
    const [reg, usage] = await Promise.all([
      apiGetRegistryItems(),
      apiGetUsageDashboard(usageCliFilter),
    ]);
    setRegistryItems(reg);
    setUsageDashboard(usage);
    showToast(
      `항목 상태가 ${enabled ? "활성화(ON)" : "비활성화(OFF)"}로 변경되었습니다.`,
      "info"
    );
  };

  const handleApplyToCli = async (itemId: string, cliId: string) => {
    try {
      const res = await apiApplyItemToCli(itemId, cliId);
      const [reg, baks] = await Promise.all([
        apiGetRegistryItems(),
        apiGetConfigBackups(),
      ]);
      setRegistryItems(reg);
      setBackups(baks);
      showToast(
        `[${cliId.toUpperCase()}] 설정 적용 완료! ${
          res.backupPath ? `(백업 생성됨: ${res.backupPath})` : ""
        }`,
        "success"
      );
    } catch (err) {
      showToast(`설정 적용 실패: ${String(err)}`, "error");
    }
  };

  const handleCreateRegistryItem = async (payload: {
    id: string;
    kind: string;
    name: string;
    description: string;
    configJson: string;
    appliedClis: string[];
  }) => {
    await apiUpsertRegistryItem(payload);
    const reg = await apiGetRegistryItems();
    setRegistryItems(reg);
    showToast(`'${payload.name}' 항목이 중앙 레지스트리에 등록되었습니다.`, "success");
  };

  const handleScanLocalExtensions = async () => {
    try {
      const reg = await apiScanLocalExtensions();
      setRegistryItems(reg);
      const detected = await apiDetectClis();
      setClis(detected);
      showToast(
        `로컬 PC의 CLI · MCP · 스킬 · 플러그인 스캔이 완료되었습니다 (총 ${reg.length}개 항목).`,
        "success"
      );
    } catch (err) {
      showToast(`로컬 확장 스캔 실패: ${String(err)}`, "error");
    }
  };

  const handleAddCustomCli = async (input: CustomCliInput) => {
    try {
      const updated = await apiAddCustomCli(input);
      setClis(updated);
      const keys = await apiGetApiKeys();
      setApiKeys(keys);
      showToast(`'${input.name}' CLI 도구가 추가되었습니다.`, "success");
    } catch (err) {
      showToast(`CLI 추가 실패: ${String(err)}`, "error");
    }
  };

  const handleDeleteCustomCli = async (cliId: string) => {
    try {
      const updated = await apiDeleteCustomCli(cliId);
      setClis(updated);
      showToast("커스텀 CLI가 삭제되었습니다.", "info");
    } catch (err) {
      showToast(`CLI 삭제 실패: ${String(err)}`, "error");
    }
  };

  const handleSaveApiKey = async (
    cliId: string,
    keyName: string,
    rawKey: string
  ) => {
    try {
      await apiSaveApiKey(cliId, keyName, rawKey);
      const keys = await apiGetApiKeys();
      setApiKeys(keys);
      showToast(
        `${keyName}가 안전하게 암호화 저장되었습니다. 새 세션부터 자동 주입됩니다.`,
        "success"
      );
    } catch (err) {
      showToast(`API 키 저장 실패: ${String(err)}`, "error");
    }
  };

  const handleDeleteApiKey = async (cliId: string, keyName: string) => {
    await apiDeleteApiKey(cliId, keyName);
    const keys = await apiGetApiKeys();
    setApiKeys(keys);
    showToast(`${keyName}가 삭제되었습니다.`, "info");
  };

  const headroomItem = registryItems.find((i) => i.id === "headroom-mcp");
  const headroomEnabled = headroomItem?.enabled ?? true;
  const cavemanEnabled =
    registryItems.find((i) => i.id === "caveman-skill")?.enabled ?? true;

  const globalNavItems: {
    id: ActiveNavTab;
    label: string;
    icon: React.ReactNode;
    badge?: string;
  }[] = [
    {
      id: "usage",
      label: "사용량 · 히스토리 · 비교",
      icon: <Activity className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: "mcp",
      label: "플러그인 · 스킬 · MCP",
      icon: <Blocks className="w-3.5 h-3.5 shrink-0" />,
      badge: registryItems.length > 0 ? String(registryItems.length) : "ON",
    },
    {
      id: "auth",
      label: "CLI 관리 · 인증 · API 키",
      icon: <KeyRound className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: "team",
      label: "팀 사용량 대시보드",
      icon: <Users className="w-3.5 h-3.5 shrink-0" />,
    },
  ];

  const activeSessionForQuota = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const [lastFocusedCliId, setLastFocusedCliId] = useState<string>(() => {
    return localStorage.getItem("ai_cli_preferred_mini_cli") || "claude";
  });

  const handleCycleMiniCli = () => {
    const supported = ["claude", "antigravity", "codex", "grok"];
    const currIdx = supported.indexOf(lastFocusedCliId);
    const nextCli = supported[(currIdx + 1) % supported.length];
    setLastFocusedCliId(nextCli);
    try {
      localStorage.setItem("ai_cli_preferred_mini_cli", nextCli);
    } catch {}
  };

  useEffect(() => {
    if (activeSessionForQuota?.cliId) {
      setLastFocusedCliId(activeSessionForQuota.cliId);
      apiGetUsageDashboard(usageCliFilter)
        .then(setUsageDashboard)
        .catch(() => {});
    }
  }, [activeSessionForQuota?.id, activeSessionForQuota?.cliId, usageCliFilter, setUsageDashboard]);

  useEffect(() => {
    if (activeNav === "usage" && usageCliFilter && usageCliFilter !== "all") {
      setLastFocusedCliId(usageCliFilter);
    }
  }, [activeNav, usageCliFilter]);

  const focusedCliId = lastFocusedCliId || activeSessionForQuota?.cliId || "claude";
  const focusedCliDef = clis.find((c) => c.id === focusedCliId);
  const sidebarQuota =
    usageDashboard?.cliQuotas?.find((q) => q.cliId === focusedCliId) ?? null;

  // 0ms 즉각 렌더링을 위한 직전 쿼터 로컬 스냅샷 복원 (CLI별로 분리 저장하여 즉각 복원)
  const [cachedMiniQuota, setCachedMiniQuota] = useState<{
    cliId: string;
    cliName: string;
    planLabel: string;
    accentColor: string;
    remainPct5h: number;
    remainPctWeekly: number;
    resetsAt5h: string | null;
    resetsAtWeekly: string | null;
  }>(() => {
    try {
      const perCli = localStorage.getItem(`agentrix_mini_quota_${focusedCliId}`);
      if (perCli) return JSON.parse(perCli);
      const raw = localStorage.getItem("agentrix_mini_quota_cached");
      if (raw) return JSON.parse(raw);
    } catch {}
    if (focusedCliId === "antigravity") {
      return {
        cliId: "antigravity",
        cliName: "Antigravity (agy)",
        planLabel: "Google DeepMind",
        accentColor: "#a855f7",
        remainPct5h: 90,
        remainPctWeekly: 70,
        resetsAt5h: "오늘 18:59 리셋",
        resetsAtWeekly: "11/02 14:04 리셋",
      };
    }
    return {
      cliId: "claude",
      cliName: "Claude Code",
      planLabel: "Claude Pro",
      accentColor: "#f97316",
      remainPct5h: 46,
      remainPctWeekly: 74,
      resetsAt5h: "오늘 13:50 리셋",
      resetsAtWeekly: "11/01 20:00 리셋",
    };
  });

  // focusedCliId 변경 시 해당 CLI의 캐시로 즉시 전환 (0ms 지연 없음)
  useEffect(() => {
    try {
      const perCli = localStorage.getItem(`agentrix_mini_quota_${focusedCliId}`);
      if (perCli) {
        setCachedMiniQuota(JSON.parse(perCli));
        return;
      }
    } catch {}
    if (focusedCliId === "antigravity") {
      setCachedMiniQuota({
        cliId: "antigravity",
        cliName: "Antigravity (agy)",
        planLabel: "Google DeepMind",
        accentColor: "#a855f7",
        remainPct5h: 90,
        remainPctWeekly: 70,
        resetsAt5h: "오늘 18:59 리셋",
        resetsAtWeekly: "11/02 14:04 리셋",
      });
    } else if (focusedCliId === "claude") {
      setCachedMiniQuota({
        cliId: "claude",
        cliName: "Claude Code",
        planLabel: "Claude Pro",
        accentColor: "#f97316",
        remainPct5h: 46,
        remainPctWeekly: 74,
        resetsAt5h: "오늘 13:50 리셋",
        resetsAtWeekly: "11/01 20:00 리셋",
      });
    }
  }, [focusedCliId]);

  // 유효한 실시간 쿼터가 들어왔을 때만 캐시 갱신 (더미 100% 빈 껍데기는 이전 캐시를 덮어쓰지 못하도록 방어)
  useEffect(() => {
    if (sidebarQuota && (sidebarQuota.hasOfficialQuota || sidebarQuota.resetsAt5h)) {
      const updated = {
        cliId: sidebarQuota.cliId,
        cliName: sidebarQuota.cliName,
        planLabel: sidebarQuota.planLabel,
        accentColor: focusedCliDef?.accentColor ?? "#6366f1",
        remainPct5h: Math.round(sidebarQuota.remainingPercent5h),
        remainPctWeekly: Math.round(sidebarQuota.remainingPercentWeekly),
        resetsAt5h: sidebarQuota.resetsAt5h,
        resetsAtWeekly: sidebarQuota.resetsAtWeekly,
      };
      setCachedMiniQuota(updated);
      try {
        localStorage.setItem("agentrix_mini_quota_cached", JSON.stringify(updated));
        localStorage.setItem(`agentrix_mini_quota_${sidebarQuota.cliId}`, JSON.stringify(updated));
      } catch {}
    }
  }, [sidebarQuota, focusedCliDef?.accentColor]);

  // 실시간 쿼터가 유효한지 검증 (공식 연동이거나 리셋 시간이 존재하는 경우에만 사용, 더미 100% 배제)
  const isSidebarQuotaValid = Boolean(
    sidebarQuota && (sidebarQuota.hasOfficialQuota || sidebarQuota.resetsAt5h)
  );

  const activeCliName = (isSidebarQuotaValid ? sidebarQuota?.cliName : null) ?? focusedCliDef?.name ?? cachedMiniQuota.cliName;
  const activePlanLabel = (isSidebarQuotaValid ? sidebarQuota?.planLabel : null) ?? cachedMiniQuota.planLabel;
  const activeAccentColor = focusedCliDef?.accentColor ?? cachedMiniQuota.accentColor;
  const activeRemainPct5h = isSidebarQuotaValid ? Math.round(sidebarQuota!.remainingPercent5h) : cachedMiniQuota.remainPct5h;
  const activeRemainPctWk = isSidebarQuotaValid ? Math.round(sidebarQuota!.remainingPercentWeekly) : cachedMiniQuota.remainPctWeekly;
  const activeReset5h = isSidebarQuotaValid ? sidebarQuota!.resetsAt5h : cachedMiniQuota.resetsAt5h;
  const activeResetWk = isSidebarQuotaValid ? sidebarQuota!.resetsAtWeekly : cachedMiniQuota.resetsAtWeekly;

  const pct5h = 100 - activeRemainPct5h;
  const remainPct5h = activeRemainPct5h;
  const pctWeekly = 100 - activeRemainPctWk;
  const remainPctWeekly = activeRemainPctWk;

  const selectedFolderName = getShortFolderName(selectedProjectPath);

  const [isMaximized, setIsMaximized] = useState(false);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);

  useEffect(() => {
    apiWindowIsMaximized().then(setIsMaximized).catch(() => {});
    const onResize = () => {
      apiWindowIsMaximized().then(setIsMaximized).catch(() => {});
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 시스템 트레이에서 쿼터 갱신 이벤트 수신 시 실시간 동기화
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("tray-quota-refreshed", () => {
      apiGetUsageDashboard("all", usageTimeframe).then(setUsageDashboard).catch(() => {});
      showToast("시스템 트레이에서 쿼터 사용량이 새로고침되었습니다.", "success");
    }).then((u) => { unlisten = u; }).catch(() => {});
    return () => { if (unlisten) unlisten(); };
  }, [usageTimeframe, setUsageDashboard]);

  // 프로급 생산성 단축키 지원 (Alt+1~4: 터미널 포커스, Alt+S: 레이아웃 순환, F11: 전체화면)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // F11: 창 최대화 / 복원 토글
      if (e.key === "F11") {
        e.preventDefault();
        handleWindowToggleMaximize();
        return;
      }
      // Alt + 1 ~ 4: 분할 터미널 슬롯 즉시 포커스 이동
      if (e.altKey && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const targetSession = resolvedPaneSessions[idx];
        if (targetSession) {
          setActiveNav("terminal");
          setProjectSubView("session");
          setActiveSessionId(targetSession.id);
          setLastFocusedCliId(targetSession.cliId);
          showToast(`터미널 #${idx + 1} (${targetSession.name}) 포커스`, "info");
        }
        return;
      }
      // Alt + S: 터미널 분할 레이아웃 순환 (단일 -> 좌우 -> 상하 -> 4분할)
      if (e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const cycle = ["single", "split-h", "split-v", "grid-4"] as const;
        const curIdx = cycle.indexOf(splitLayout as any);
        const nextLayout = cycle[(curIdx + 1) % cycle.length];
        setSplitLayout(nextLayout);
        const labels: Record<string, string> = {
          single: "단일 전체 화면",
          "split-h": "좌우 2분할 (Side-by-Side)",
          "split-v": "위아래 2분할 (Top-Bottom)",
          "grid-4": "4군데 격자 4분할 (2x2 Grid)",
        };
        showToast(`레이아웃 전환: ${labels[nextLayout]}`, "info");
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [splitLayout, resolvedPaneSessions]);

  const handleWindowMinimize = () => {
    apiWindowMinimize().catch(() => {});
  };

  const handleWindowToggleMaximize = () => {
    apiWindowToggleMaximize()
      .then(() => apiWindowIsMaximized().then(setIsMaximized))
      .catch(() => {});
  };

  // 닫기(X) 클릭 시: 세션이 남아있으면 세션 보호 모달 띄우고, 없으면 트레이로 즉시 숨김
  const handleAttemptClose = () => {
    if (sessions.length > 0) {
      setShowExitConfirmModal(true);
    } else {
      apiWindowHide().catch(() => apiWindowClose().catch(() => {}));
      showToast("AgentriX가 시스템 트레이로 숨겨졌습니다.", "info");
    }
  };

  const handleMinimizeToTray = () => {
    setShowExitConfirmModal(false);
    apiWindowHide().catch(() => {});
    showToast("세션이 백그라운드에서 유지되며 트레이로 숨겨졌습니다.", "info");
  };

  const handleConfirmExitAll = async () => {
    setShowExitConfirmModal(false);
    for (const s of sessions) {
      try {
        await apiStopSession(s.id);
      } catch {}
    }
    apiWindowExit().catch(() => apiWindowClose().catch(() => {}));
  };

  const lastToggleTimeRef = useRef(0);
  const handleTitlebarDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) {
      return;
    }
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 400) return;
    lastToggleTimeRef.current = now;
    handleWindowToggleMaximize();
  };

  const handleStartDragging = (e: React.MouseEvent) => {
    if (
      e.button === 0 &&
      e.detail === 1 &&
      !(e.target as HTMLElement).closest("button, a, input, select, textarea")
    ) {
      apiWindowStartDragging().catch(() => {});
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden select-none border border-slate-800/60">
      {/* =====================================================================
          최상단 통합 타이틀바 (Custom Window Frame & Drag Region):
          - OS 기본 회색 타이틀바를 완전히 대체하여 앱의 다크 슬레이트 테마와 완벽 일체화
          - 드래그 이동(data-tauri-drag-region + start_dragging) 및 더블클릭 최대화/복원 지원
          - 좌: 브랜드 로고 및 앱 타이틀 + 사이드바 토글
          - 중: 현재 프로젝트 및 작업 컨텍스트 브레드크럼
          - 우: 시스템 상태 배지 + 창 제어 컨트롤(최소화, 최대화/복원, 닫기)
         ===================================================================== */}
      <header
        data-tauri-drag-region
        onMouseDown={handleStartDragging}
        onDoubleClick={handleTitlebarDoubleClick}
        className="relative h-10 min-h-[40px] max-h-[40px] bg-slate-900/95 backdrop-blur border-b border-slate-800/80 flex items-center justify-between px-3 select-none z-50 shrink-0 cursor-default"
      >
        {/* 좌: 사이드바 열기 / 닫기 버튼 */}
        <div className="flex items-center z-10" data-tauri-drag-region onMouseDown={handleStartDragging}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-slate-700 hover:text-slate-950 hover:bg-slate-200/80 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition text-xs font-semibold"
            title={sidebarCollapsed ? "사이드바 열기" : "사이드바 닫기"}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            ) : (
              <PanelLeftClose className="w-4 h-4 text-slate-600 dark:text-slate-400" />
            )}
            <span className="text-[11px] hidden sm:inline text-slate-800 dark:text-slate-300 font-semibold">
              {sidebarCollapsed ? "사이드바 열기" : "사이드바 닫기"}
            </span>
          </button>
        </div>

        {/* 중: 윈도우 정중앙 절대좌표 앱 로고 & 프로그램 이름 (좌우 비대칭 버튼 너비에 영향받지 않고 100% 정중앙 고정) */}
        <div
          data-tauri-drag-region
          onMouseDown={handleStartDragging}
          onDoubleClick={handleTitlebarDoubleClick}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 select-none cursor-default z-0 pointer-events-none"
        >
          <AgentrixLogo
            isDark={
              themeMode === "dark" ||
              (themeMode === "auto" &&
                typeof window !== "undefined" &&
                window.matchMedia("(prefers-color-scheme: dark)").matches)
            }
            size={22}
            className="rounded shadow-sm drop-shadow-sm"
          />
          <span className="text-xs font-extrabold text-slate-900 dark:text-slate-100 tracking-tight whitespace-nowrap">
            AgentriX
          </span>
        </div>

        {/* 우: 테마 스위처 + 창 제어 컨트롤 (최소화, 최대화, 닫기) */}
        <div className="flex items-center justify-end gap-2 shrink-0 z-10">
          {/* 테마 스위처 (자동, 다크, 라이트) */}
          <div className="flex items-center p-0.5 rounded-lg border text-[11px] bg-slate-200/90 border-slate-300 dark:bg-slate-950 dark:border-slate-800">
            <button
              onClick={() => handleThemeChange("dark")}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                themeMode === "dark"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-700 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
              title="다크 모드"
            >
              🌙<span className="hidden md:inline ml-1">다크</span>
            </button>
            <button
              onClick={() => handleThemeChange("light")}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                themeMode === "light"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-700 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
              title="라이트 모드"
            >
              ☀️<span className="hidden md:inline ml-1">라이트</span>
            </button>
            <button
              onClick={() => handleThemeChange("auto")}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                themeMode === "auto"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-700 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
              title="시스템 설정 자동"
            >
              💻<span className="hidden md:inline ml-1">자동</span>
            </button>
          </div>

          {/* 토큰 최적화 버튼 (이중 박스 제거, 단일 캡슐 인라인 고대비 레이아웃) */}
          <button
            onClick={() => setShowTokenOptModal(true)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold transition shadow-sm bg-amber-500/10 border-amber-500/30 text-amber-900 hover:bg-amber-500/20 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-200 dark:hover:bg-amber-500/25"
            title="토큰 사용량 최적화 및 스마트 자동 세션 릴레이(Handoff) 설정"
          >
            <Zap className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="hidden sm:inline">토큰 최적화</span>
            <span className="font-mono font-bold text-amber-800 dark:text-amber-300">
              {activeSessionId && sessionTokens[activeSessionId] ? (
                `${Math.round(sessionTokens[activeSessionId] / 1000)}k / ${Math.round(tokenOptConfig.contextThresholdTokens / 1000)}k`
              ) : (
                `${Math.round(tokenOptConfig.contextThresholdTokens / 1000)}k`
              )}
            </span>
          </button>

          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold transition shadow-sm bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-200">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                headroomEnabled
                  ? "bg-emerald-600 dark:bg-emerald-400 animate-pulse"
                  : "bg-slate-400 dark:bg-slate-500"
              }`}
            />
            <span className="font-mono font-bold">Headroom {headroomEnabled ? "ON" : "OFF"}</span>
          </div>

          <div className="flex items-center border-l border-slate-300 dark:border-slate-800/80 ml-1 pl-1">
            <button
              onClick={handleWindowMinimize}
              className="w-8 h-7 flex items-center justify-center rounded text-slate-600 hover:text-slate-950 hover:bg-slate-200/80 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition"
              title="최소화"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleWindowToggleMaximize}
              className="w-8 h-7 flex items-center justify-center rounded text-slate-600 hover:text-slate-950 hover:bg-slate-200/80 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition"
              title={isMaximized ? "이전 크기로 복원" : "최대화"}
            >
              {isMaximized ? (
                <Copy className="w-3 h-3 rotate-180" />
              ) : (
                <Square className="w-3 h-3" />
              )}
            </button>
            <button
              onClick={handleAttemptClose}
              className="w-8 h-7 flex items-center justify-center rounded text-slate-600 hover:text-white hover:bg-rose-600 dark:text-slate-400 dark:hover:text-white dark:hover:bg-rose-600 transition"
              title="닫기 (실행 세션 유지 시 시스템 트레이로 숨김)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* 하단 메인 작업 영역 (좌측 사이드바 + 우측 본문) */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* =====================================================================
            좌측 패널 (깔끔한 프로젝트 리스트 + 프로젝트 추가 버튼 전용):
            - 상단: 글로벌 설정/대시보드 메뉴
            - 중앙: [+ 프로젝트 추가] 독립 버튼 & 프로젝트 리스트 (youtubeai, AI_CLI_MANAGER 등)
            - 프로젝트를 클릭하면 우측에 해당 프로젝트 전용 화면(ProjectWorkspaceView)이 열림!
           ===================================================================== */}
        {!sidebarCollapsed && (
          <aside className="w-[268px] min-w-[268px] max-w-[268px] shrink-0 bg-slate-900/95 border-r border-slate-800 flex flex-col justify-between overflow-hidden">
            <div className="p-3 space-y-4 overflow-y-auto overflow-x-hidden flex-1">

            {/* ===============================================================
                1. 상단 글로벌 관리 메뉴 (사용량 확인 · 플러그인/MCP · CLI/인증 · 팀 대시보드)
               =============================================================== */}
            <nav className="space-y-1">
              {globalNavItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition ${
                    activeNav === item.id
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0 truncate">
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge && (
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                        activeNav === item.id
                          ? "bg-white/20 text-white"
                          : "bg-indigo-500/20 text-indigo-300"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {/* ===============================================================
                2. 하단 [+ 프로젝트 추가] 버튼 + 프로젝트 목록
               =============================================================== */}
            <div className="pt-3 border-t border-slate-800/90 space-y-2.5">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleBrowseNativeFolder}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>프로젝트 추가</span>
                </button>
                <button
                  onClick={() => setShowAddFolderInput((v) => !v)}
                  className={`p-2 rounded-xl border transition-all shrink-0 active:scale-[0.98] ${
                    showAddFolderInput
                      ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40"
                      : "bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/80"
                  }`}
                  title="경로 직접 입력하여 프로젝트 추가"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
              </div>

              {showAddFolderInput && (
                <form onSubmit={handleAddManualFolder} className="flex gap-1.5">
                  <input
                    value={manualFolderInput}
                    onChange={(e) => setManualFolderInput(e.target.value)}
                    placeholder="C:\...\ProjectPath"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shrink-0 transition"
                  >
                    등록
                  </button>
                </form>
              )}

              <div className="pt-0.5 space-y-2">
                {/* 1. 프로젝트 목록 헤더 (접기/펴기 토글 및 새 그룹 생성 버튼) */}
                <div className="px-1 pb-1 flex items-center justify-between text-[11px] font-bold text-slate-400">
                  <button
                    type="button"
                    onClick={toggleProjectListCollapsed}
                    className="flex items-center gap-1.5 hover:text-slate-200 transition select-none"
                    title={projectListCollapsed ? "프로젝트 목록 펼치기" : "프로젝트 목록 접기"}
                  >
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-indigo-400 transition-transform duration-200 ${
                        projectListCollapsed ? "" : "rotate-90"
                      }`}
                    />
                    <span>프로젝트 목록 ({projectFolders.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setNewGroupNameInput("");
                      setSelectedProjectForNewGroup(projectFolders[0]?.path || "");
                      setIsNewGroupModalOpen(true);
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition"
                    title="새 프로젝트 그룹 만들기"
                  >
                    <FolderPlus className="w-3 h-3 text-indigo-500 dark:text-indigo-400" />
                    <span>새 그룹</span>
                  </button>
                </div>

                {/* 2. 프로젝트 목록 본문 (접힌 상태가 아닐 때만 렌더링) */}
                {!projectListCollapsed && (
                  <>
                    {projectFolders.length === 0 ? (
                      <div className="p-3 rounded-xl bg-slate-950/60 border border-dashed border-slate-800 text-center space-y-1.5">
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          아직 추가된 프로젝트가 없습니다.
                        </p>
                        <p className="text-[10px] text-slate-500">
                          위의 <b>[+ 프로젝트 추가]</b> 버튼을 눌러 작업할 폴더를 직접 추가하세요.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {Array.from(groupedProjects.entries()).map(([groupName, projs]) => {
                          const isGroupCollapsed = Boolean(collapsedGroups[groupName]);

                          return (
                            <div key={groupName} className="space-y-1.5">
                              {/* 그룹 헤더 (그룹별 접기/펴기) */}
                              <div
                                onClick={() => toggleGroupCollapsed(groupName)}
                                className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-slate-100/70 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800/70 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-900 transition text-[11px] select-none text-slate-600 dark:text-slate-400 group/grp"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <ChevronRight
                                    className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${
                                      isGroupCollapsed ? "" : "rotate-90 text-indigo-500 dark:text-indigo-400"
                                    }`}
                                  />
                                  <FolderTree className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                                  <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                                    {groupName}
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                                    {projs.length}
                                  </span>
                                </div>
                                {groupName !== "기본 프로젝트" && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteGroup(groupName, e)}
                                    className="opacity-0 group-hover/grp:opacity-100 p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition"
                                    title={`'${groupName}' 그룹 삭제`}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>

                              {/* 그룹 내 프로젝트 카드 목록 */}
                              {!isGroupCollapsed && (
                                <div className="space-y-1.5 pl-1">
                                  {projs.length === 0 ? (
                                    <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950/40 border border-dashed border-slate-200 dark:border-slate-800 text-[10px] text-slate-400 dark:text-slate-500 text-center">
                                      할당된 프로젝트가 없습니다
                                    </div>
                                  ) : (
                                    projs.map((proj) => {
                                    const isSelected =
                                      activeNav === "terminal" &&
                                      selectedProjectPath === proj.path;
                                    const projSessions = sessions.filter(
                                      (s) => s.cwd === proj.path
                                    );

                                    return (
                                      <div key={proj.path} className="space-y-1">
                                        <div
                                          onClick={() => handleSelectProject(proj.path)}
                                          className={`group px-2.5 py-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all ${
                                            isSelected
                                              ? "bg-indigo-500/10 border-indigo-500/50 border-l-[3px] border-l-indigo-500 text-indigo-400 dark:text-indigo-300 font-semibold shadow-sm"
                                              : "bg-slate-900/30 border-slate-800/80 text-slate-300 hover:bg-slate-800/50 hover:border-slate-700/80"
                                          }`}
                                        >
                                          <div className="flex items-center gap-2 min-w-0">
                                            <FolderOpen
                                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                                isSelected ? "text-indigo-500 dark:text-indigo-400" : "text-slate-400"
                                              }`}
                                            />
                                            <span className="text-xs truncate">
                                              {proj.name}
                                            </span>
                                          </div>

                                          <div className="flex items-center gap-1 shrink-0">
                                            {projSessions.length > 0 && (
                                              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold">
                                                {projSessions.length}
                                              </span>
                                            )}

                                            {/* 그룹 변경 버튼 */}
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setGroupModalProjPath(proj.path);
                                                setTargetGroupName(groupName);
                                              }}
                                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-indigo-300 transition"
                                              title="그룹 변경 / 새 그룹 지정"
                                            >
                                              <Tag className="w-3 h-3" />
                                            </button>

                                            {/* 삭제 버튼 */}
                                            <button
                                              onClick={(e) =>
                                                handleRemoveProjectFolder(proj.path, e)
                                              }
                                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-400 transition"
                                              title="프로젝트 목록에서 제거"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        </div>

                                        {/* 해당 프로젝트에서 실행 중인 에이전트/CLI 세션 트리 표시 */}
                                        {projSessions.length > 0 && (
                                          <div className="border-l-2 border-slate-800/80 ml-3 pl-2.5 my-1 space-y-1">
                                            {projSessions.map((s) => {
                                              const isSessionActive =
                                                activeNav === "terminal" &&
                                                projectSubView === "session" &&
                                                activeSessionId === s.id;
                                              return (
                                                <div
                                                  key={s.id}
                                                  onClick={() => {
                                                    setSelectedProjectPath(proj.path);
                                                    setActiveNav("terminal");
                                                    setActiveSessionId(s.id);
                                                    setProjectSubView("session");
                                                  }}
                                                  className={`group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg text-[11px] cursor-pointer border transition-all ${
                                                    isSessionActive
                                                      ? "bg-indigo-600/15 border-indigo-500/40 text-indigo-300 font-semibold shadow-sm"
                                                      : "bg-slate-900/20 border-slate-800/50 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                                                  }`}
                                                >
                                                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                                                    <Terminal className="w-3 h-3 text-emerald-400 shrink-0" />
                                                    <span className="truncate">{s.name}</span>
                                                  </div>
                                                  <button
                                                    onClick={(e) => handleStopSession(s.id, e)}
                                                    className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-400 shrink-0 transition"
                                                    title="세션 종료"
                                                  >
                                                    <X className="w-3 h-3" />
                                                  </button>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 사이드바 하단: 현재 포커스된 CLI 한도 실시간 미니 위젯 (가독성 & 디자인 대폭 강화) */}
          <div className="p-3 border-t border-slate-800 bg-slate-950/80 space-y-2.5 text-xs shrink-0">
            <div
              onClick={handleCycleMiniCli}
              className="flex items-center justify-between gap-1 text-[11px] cursor-pointer group hover:bg-slate-900/80 p-1 -m-1 rounded-lg transition"
              title="클릭하여 모니터링 CLI 전환 (Claude ↔ Antigravity ↔ Codex ↔ Grok)"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: activeAccentColor,
                  }}
                />
                <span className="font-bold text-slate-100 truncate group-hover:text-indigo-300 transition">
                  {activeCliName}
                </span>
                {activePlanLabel && (
                  <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                    ({activePlanLabel})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {activeReset5h && focusedCliId !== "grok" ? (
                  <span className="text-[10px] font-mono text-amber-300 font-semibold shrink-0">
                    {activeReset5h}
                  </span>
                ) : activeResetWk ? (
                  <span className="text-[10px] font-mono text-indigo-300 font-semibold shrink-0">
                    {activeResetWk}
                  </span>
                ) : null}
                <ArrowUpDown className="w-3 h-3 text-slate-500 group-hover:text-indigo-400 transition" />
              </div>
            </div>

            {/* 5시간 한도 게이지 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 font-medium">5시간 잔여</span>
                <span
                  className={`font-mono text-xs font-bold ${
                    remainPct5h <= 10 ? "text-rose-400" : "text-emerald-400"
                  }`}
                >
                  {remainPct5h}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    pct5h >= 90
                      ? "bg-rose-500"
                      : pct5h >= 60
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, pct5h)}%` }}
                />
              </div>
            </div>

            {/* 주간 한도 게이지 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 font-medium">주간 잔여</span>
                <span
                  className={`font-mono text-xs font-bold ${
                    remainPctWeekly <= 15 ? "text-rose-400" : "text-indigo-300"
                  }`}
                >
                  {remainPctWeekly}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    pctWeekly >= 85
                      ? "bg-rose-500"
                      : "bg-indigo-500"
                  }`}
                  style={{ width: `${Math.min(100, pctWeekly)}%` }}
                />
              </div>
            </div>

            {/* 토큰 최적화 도구 상태 뱃지 */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                  headroomEnabled
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-slate-800 text-slate-500 border-slate-700"
                }`}
              >
                <Sparkles className="w-2.5 h-2.5" />
                Headroom {headroomEnabled ? "ON" : "OFF"}
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                  cavemanEnabled
                    ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/30"
                    : "bg-slate-800 text-slate-500 border-slate-700"
                }`}
              >
                Caveman {cavemanEnabled ? "ON" : "OFF"}
              </span>
            </div>
          </div>
        </aside>
      )}

      {/* =====================================================================
          우측 메인 콘텐츠 영역:
          - 상단 헤더 바: [🏠 프로젝트 홈 & 에이전트 추천/편성] 탭 + 실행 중인 에이전트/CLI 세션 탭들
          - 본문: 프로젝트 클릭 시 ProjectWorkspaceView가 기본으로 표시됨!
         ===================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-11 shrink-0 bg-slate-900 border-b border-slate-800 px-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0 py-1">
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition shrink-0"
                title="좌측 패널 펼치기"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}

            {/* 활성 네비게이션이 terminal이 아닐 때: 간결하고 직관적인 페이지 헤더 */}
            {activeNav === "usage" ? (
              <div className="flex items-center gap-2 px-1 text-xs">
                <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-bold text-slate-100">
                  사용량 · 구독 쿼터
                </span>
              </div>
            ) : activeNav === "mcp" ? (
              <div className="flex items-center gap-2 px-1 text-xs">
                <Boxes className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="font-bold text-slate-100">
                  플러그인 · 스킬 · MCP
                </span>
              </div>
            ) : activeNav === "auth" ? (
              <div className="flex items-center gap-2 px-1 text-xs">
                <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-bold text-slate-100">
                  CLI 인증 · API 키
                </span>
              </div>
            ) : activeNav === "team" ? (
              <div className="flex items-center gap-2 px-1 text-xs">
                <Users className="w-4 h-4 text-fuchsia-400 shrink-0" />
                <span className="font-bold text-slate-100">
                  팀 사용량 대시보드
                </span>
              </div>
            ) : !selectedProjectPath ? (
              <span className="text-xs text-slate-400 font-medium px-2 truncate">
                좌측 프로젝트 목록에서 작업할 프로젝트를 선택하거나 추가해 주세요.
              </span>
            ) : currentProjectSessions.length === 0 ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setActiveNav("terminal");
                    setProjectSubView("overview");
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 transition shadow-sm"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>{selectedFolderName} (홈)</span>
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => {
                    setActiveNav("terminal");
                    setProjectSubView("overview");
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition shrink-0 whitespace-nowrap ${
                    activeNav === "terminal" && projectSubView === "overview"
                      ? "bg-cyan-600 text-white border-cyan-400 shadow-sm"
                      : "bg-slate-800/80 text-cyan-300 border-cyan-500/30 hover:bg-slate-800"
                  }`}
                  title={`${selectedFolderName} 프로젝트 화면으로 돌아가기`}
                >
                  <Home className="w-3.5 h-3.5 shrink-0" />
                  <span>프로젝트 화면</span>
                </button>

                {currentProjectSessions.map((s) => {
                  const isPrimary =
                    activeNav === "terminal" &&
                    projectSubView === "session" &&
                    activeSessionId === s.id;
                  const isVisibleInSplit =
                    activeNav === "terminal" &&
                    projectSubView === "session" &&
                    splitLayout !== "single" &&
                    resolvedPaneSessions
                      .slice(0, visibleSlotCount)
                      .some((p) => p?.id === s.id);
                  const cliDef = clis.find((c) => c.id === s.cliId);

                  return (
                    <div
                      key={s.id}
                      onClick={() => {
                        setActiveNav("terminal");
                        setActiveSessionId(s.id);
                        setProjectSubView("session");
                      }}
                      title={`${s.name} ${s.agentRole ? `(${s.agentRole})` : ""}`}
                      className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer border transition shrink-0 whitespace-nowrap ${
                        isPrimary
                          ? "bg-slate-950 text-white border-indigo-500/80 shadow-sm"
                          : isVisibleInSplit
                          ? "bg-slate-950/70 text-indigo-300 border-indigo-500/40"
                          : "bg-slate-800/60 text-slate-400 border-slate-700/60 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: cliDef?.accentColor ?? "#818cf8",
                        }}
                      />
                      <span className="font-semibold">{s.name}</span>

                      <button
                        onClick={(e) => handleStopSession(s.id, e)}
                        className="p-0.5 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-700/60"
                        title="세션 종료"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeNav === "terminal" &&
              Boolean(selectedProjectPath) &&
              projectSubView === "session" &&
              sessions.length > 0 && (
                <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px] shrink-0 gap-0.5">
                  <button
                    onClick={() => setSplitLayout("single")}
                    className={`px-2 py-1 rounded flex items-center gap-1 font-semibold transition ${
                      splitLayout === "single"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="단일 터미널 전체 화면 (1개)"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">단일</span>
                  </button>
                  <button
                    onClick={() => setSplitLayout("split-h")}
                    className={`px-2 py-1 rounded flex items-center gap-1 font-semibold transition ${
                      splitLayout === "split-h"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="양쪽 좌우 2분할 (Side by Side)"
                  >
                    <Columns2 className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">좌우</span>
                  </button>
                  <button
                    onClick={() => setSplitLayout("split-v")}
                    className={`px-2 py-1 rounded flex items-center gap-1 font-semibold transition ${
                      splitLayout === "split-v"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="위아래 상하 2분할 (Stacked)"
                  >
                    <Rows2 className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">상하</span>
                  </button>
                  <button
                    onClick={() => setSplitLayout("grid-4")}
                    className={`px-2 py-1 rounded flex items-center gap-1 font-semibold transition ${
                      splitLayout === "grid-4"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="4군데 격자 4분할 (2x2 Grid)"
                  >
                    <Grid2X2 className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">4분할</span>
                  </button>
                </div>
              )}
          </div>
        </header>

        {/* 본문 영역 */}
        <main className="flex-1 min-h-0 relative w-full overflow-hidden bg-slate-950">
          {/* 1-0) 아직 추가된/선택된 프로젝트가 없을 때: 프로젝트 추가 안내 화면 */}
          {activeNav === "terminal" && !selectedProjectPath && (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
              <div className="max-w-md p-8 rounded-2xl bg-slate-900/60 border border-dashed border-slate-800 space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
                  <FolderPlus className="w-7 h-7 text-cyan-400" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-lg font-bold text-slate-100">
                    작업할 프로젝트를 추가해 주세요
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    좌측 패널 상단의 <b>[+ 프로젝트 추가]</b> 버튼이나 아래 버튼을 눌러 프로젝트 폴더를 추가하면, 해당 프로젝트의 기술 스택을 분석하여 맞춤형 AI 에이전트 팀을 추천해 드립니다.
                  </p>
                </div>
                <div className="pt-2 flex flex-col gap-2">
                  <button
                    onClick={handleBrowseNativeFolder}
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg transition"
                  >
                    <Plus className="w-4 h-4" />
                    프로젝트 추가 (Windows 폴더 찾기)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 1-A) 프로젝트 전용 화면 (ProjectWorkspaceView): 좌패널에서 프로젝트를 클릭했을 때 기본으로 뜨는 화면 */}
          {activeNav === "terminal" &&
            Boolean(selectedProjectPath) &&
            (projectSubView === "overview" || sessions.length === 0) && (
              <ProjectWorkspaceView
                projectPath={selectedProjectPath}
                analysis={projectAnalysis}
                agents={projectAgents}
                clis={clis}
                runningSessions={currentProjectSessions}
                onAddRecommendedAgent={handleAddRecommendedAgent}
                onAddAllRecommended={handleAddAllRecommended}
                onOpenCreateCustomAgent={openCreateAgentModal}
                onOpenEditAgent={openEditAgentModal}
                onDeleteAgent={handleDeleteProjectAgent}
                onSpawnAgent={handleSpawnAgentSession}
                onSpawnAllAgents={handleSpawnAllProjectAgents}
                onFocusSession={(sessionId) => {
                  setActiveSessionId(sessionId);
                  setProjectSubView("session");
                }}
                onStartRawCli={async (cliId, initialCmd) => {
                  await handleStartRawCliSession(cliId, initialCmd);
                }}
                onOpenBlackboard={handleOpenBlackboard}
                onOpenDispatchModal={() => setShowDispatchModal(true)}
                onOpenAiDeepModal={handleOpenAiDeepModal}
                headroomAppliedClis={headroomItem?.appliedClis}
                onApplyHeadroomToCli={async (cliId) => {
                  await handleApplyToCli("headroom-mcp", cliId);
                }}
                onStartAutoRelay={handleStartAutonomousCollaboration}
                onStartAutoRelayWithGoal={handleStartAutonomousRelayWithGoal}
                onToggleAgentWrapper={handleToggleAgentWrapper}
                onToggleAllAgentsWrapper={handleToggleAllAgentsWrapper}
                onSendPromptToAgent={handleSendPromptToAgent}
                onTrustProjectFolder={handleTrustProjectFolder}
              />
            )}

          {/* 1-B) 멀티 에이전트 / CLI 터미널 뷰 (단일 / 좌우 2분할 / 상하 2분할 / 4분할 격자 지원) */}
          <div
            className={`w-full h-full p-2 ${
              activeNav === "terminal" &&
              projectSubView === "session" &&
              sessions.length > 0
                ? splitLayout === "single"
                  ? "flex"
                  : splitLayout === "split-h"
                  ? "flex flex-row gap-2"
                  : splitLayout === "split-v"
                  ? "flex flex-col gap-2"
                  : "grid grid-cols-2 grid-rows-2 gap-2"
                : "hidden"
            }`}
          >
            {Array.from({ length: visibleSlotCount }).map((_, slotIdx) => {
              const session = resolvedPaneSessions[slotIdx];
              const slotClass =
                splitLayout === "single"
                  ? "w-full h-full min-w-0"
                  : splitLayout === "split-h"
                  ? "flex-1 h-full min-w-0"
                  : splitLayout === "split-v"
                  ? "flex-1 w-full min-h-0"
                  : "w-full h-full min-w-0 min-h-0 overflow-hidden";

              if (!session) {
                return (
                  <div
                    key={`empty-slot-${slotIdx}`}
                    className={`${slotClass} flex flex-col items-center justify-center p-6 bg-slate-900/40 border-2 border-dashed border-slate-800 rounded-xl text-center space-y-3`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                      <Terminal className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-slate-200">
                        분할 터미널 슬롯 #{slotIdx + 1} (비어있음)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        실행할 AI CLI를 선택하면 이 위치에 즉시 실행됩니다
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 max-w-sm">
                      {clis.map((cli) => (
                        <button
                          key={cli.id}
                          onClick={() => handleStartRawCliSession(cli.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-700/80 hover:border-indigo-500/50 transition shadow-sm"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: cli.accentColor }}
                          />
                          <span>{cli.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              const cliDef = clis.find((c) => c.id === session.cliId);
              const sameProjCount = sessions.filter(
                (s) => s.cwd === session.cwd
              ).length;

              return (
                <div
                  key={session.id}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setLastFocusedCliId(session.cliId);
                  }}
                  onMouseDown={() => {
                    setActiveSessionId(session.id);
                    setLastFocusedCliId(session.cliId);
                  }}
                  className={`${slotClass} flex flex-col bg-slate-950 rounded-xl overflow-hidden border transition-all ${
                    activeSessionId === session.id
                      ? "border-indigo-500/90 ring-2 ring-indigo-500/50 shadow-lg shadow-indigo-950/60"
                      : "border-slate-800/90 hover:border-slate-700"
                  }`}
                >
                  {/* 분할 모드일 때 각 슬롯 상단 컨트롤 바 */}
                  {splitLayout !== "single" && (
                    <div className="flex items-center justify-between px-2.5 py-1 bg-slate-900/95 border-b border-slate-800 text-xs shrink-0 select-none">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-bold text-[10px] shrink-0">
                          #{slotIdx + 1}
                        </span>
                        {sessions.length > 1 ? (
                          <select
                            value={session.id}
                            onChange={(e) =>
                              handleAssignSessionToSlot(slotIdx, e.target.value)
                            }
                            className="bg-slate-950 text-slate-200 border border-slate-700/80 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-indigo-500 truncate max-w-[170px]"
                          >
                            {sessions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} {s.agentRole ? `(${s.agentRole})` : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-semibold text-slate-200 truncate text-xs">
                            {session.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            setActiveSessionId(session.id);
                            setSplitLayout("single");
                          }}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
                          title="이 터미널을 단일 전체 화면으로 확대"
                        >
                          <Maximize2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => handleStopSession(session.id, e)}
                          className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                          title="세션 종료"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex-1 min-h-0 min-w-0 w-full h-full">
                    <TerminalPane
                      session={session}
                      cliDef={cliDef}
                      isVisible={
                        activeNav === "terminal" && projectSubView === "session"
                      }
                      isFocused={activeSessionId === session.id}
                      headroomEnabled={headroomEnabled}
                      cavemanEnabled={cavemanEnabled}
                      splitActive={splitLayout !== "single"}
                      projectAgentCount={sameProjCount}
                      estimatedTokens={sessionTokens[session.id] || 0}
                      contextThresholdTokens={tokenOptConfig.contextThresholdTokens}
                      onBroadcastPrompt={handleBroadcastPrompt}
                      onBroadcastToProject={handleBroadcastToProject}
                      onOutputChunk={handleSessionOutputChunk}
                      onOpenTokenOptimization={() => setShowTokenOptModal(true)}
                      onTriggerRelay={(sid) => handleAutoRelaySession(sid, true)}
                      onActivity={() => {
                        setLastFocusedCliId(session.cliId);
                        apiGetUsageDashboard(usageCliFilter)
                          .then(setUsageDashboard)
                          .catch(() => {});
                      }}
                    />
                  </div>
                </div>
              );
            })}

            {/* 현재 화면에 보이지 않는 백그라운드 세션들 (PTY 연결 및 버퍼 유지를 위해 hidden 상시 마운트) */}
            <div className="hidden" aria-hidden="true">
              {sessions
                .filter(
                  (s) =>
                    !resolvedPaneSessions
                      .slice(0, visibleSlotCount)
                      .some((p) => p?.id === s.id)
                )
                .map((hiddenSession) => (
                  <TerminalPane
                    key={hiddenSession.id}
                    session={hiddenSession}
                    cliDef={clis.find((c) => c.id === hiddenSession.cliId)}
                    isVisible={false}
                    headroomEnabled={headroomEnabled}
                    cavemanEnabled={cavemanEnabled}
                    splitActive={false}
                    projectAgentCount={1}
                    estimatedTokens={sessionTokens[hiddenSession.id] || 0}
                    contextThresholdTokens={tokenOptConfig.contextThresholdTokens}
                    onOutputChunk={handleSessionOutputChunk}
                  />
                ))}
            </div>
          </div>

          {/* 2) 사용량 · 히스토리 · 모델별 비교 뷰 */}
          {activeNav === "usage" && (
            <UsageView
              data={usageDashboard}
              cliFilter={usageCliFilter}
              onFilterChange={handleFilterChange}
              onSyncLogs={handleSyncUsage}
              timeframe={usageTimeframe}
              onTimeframeChange={handleTimeframeChange}
            />
          )}

          {/* 3) 플러그인 · 스킬 · MCP 매니저 뷰 */}
          {activeNav === "mcp" && (
            <McpSkillView
              items={registryItems}
              backups={backups}
              clis={clis}
              onToggleItem={handleToggleRegistry}
              onApplyToCli={handleApplyToCli}
              onCreateItem={handleCreateRegistryItem}
              onScanLocalExtensions={handleScanLocalExtensions}
            />
          )}

          {/* 4) 인증 & API 키 볼트 뷰 */}
          {activeNav === "auth" && (
            <AuthSettingsView
              clis={clis}
              apiKeys={apiKeys}
              onSaveKey={handleSaveApiKey}
              onDeleteKey={handleDeleteApiKey}
              onStartLoginSession={async (cliId, loginCmd) => {
                await handleStartRawCliSession(cliId, loginCmd);
              }}
              onAddCustomCli={handleAddCustomCli}
              onDeleteCustomCli={handleDeleteCustomCli}
            />
          )}

          {/* 5) 팀 모드 뷰 */}
          {activeNav === "team" && (
            <TeamModeView
              members={teamMembers}
              onRefreshTeam={handleRefreshTeam}
              onAddMember={handleAddTeamMember}
              onDeleteMember={handleDeleteTeamMember}
              userProfile={userProfile}
              onUpdateUserProfile={handleUpdateUserProfile}
              myUsage={myUsage}
            />
          )}
        </main>
      </div>
      </div>

      {/* =====================================================================
          모달 1: 프로젝트 전용 AI 에이전트 생성 / 역할 편집 모달
         ===================================================================== */}
      {showAgentModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveProjectAgent}
            className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-fuchsia-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  [{selectedFolderName}] 프로젝트 전담 에이전트{" "}
                  {editingAgentId ? "수정" : "직접 만들기"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAgentModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div className="p-2.5 rounded-lg bg-fuchsia-950/30 border border-fuchsia-500/30 text-[11px] text-fuchsia-200">
                이 에이전트와 역할 지침은 <b>{selectedFolderName}</b> 프로젝트(
                <code>.ai-agents/</code>)에만 독립적으로 저장·적용됩니다.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">
                    에이전트 이름 *
                  </label>
                  <input
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="예: 수석 아키텍트 / 백엔드 엔지니어"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    담당 역할 (Role) *
                  </label>
                  <input
                    value={agentRoleTitle}
                    onChange={(e) => setAgentRoleTitle(e.target.value)}
                    placeholder="예: 총괄 PM & 아키텍트 / DB 최적화"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">
                    배정할 AI CLI 엔진
                  </label>
                  <select
                    value={agentCliId}
                    onChange={(e) => setAgentCliId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100"
                  >
                    {clis.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.provider})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    아바타 아이콘 선택
                  </label>
                  <div className="flex items-center gap-1 flex-wrap bg-slate-950 p-1.5 rounded-lg border border-slate-700">
                    {EMOJI_OPTIONS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setAgentEmoji(em)}
                        className={`w-7 h-7 rounded flex items-center justify-center text-sm transition ${
                          agentEmoji === em
                            ? "bg-fuchsia-600 text-white"
                            : "hover:bg-slate-800"
                        }`}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  전담 역할 시스템 지침 (Role Prompt —{" "}
                  <code>.ai-agents/agents/.../ROLE.md</code>에 저장됨)
                </label>
                <textarea
                  rows={4}
                  value={agentRolePrompt}
                  onChange={(e) => setAgentRolePrompt(e.target.value)}
                  placeholder="이 에이전트가 이 프로젝트에서 수행할 구체적인 역할과 책임, 코딩 규칙을 적어주세요..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 leading-relaxed"
                  required
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agentUseWrapper}
                    onChange={(e) => setAgentUseWrapper(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-emerald-500"
                  />
                  <span>Headroom 사용</span>
                </label>

                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agentAutoBrief}
                    onChange={(e) => setAgentAutoBrief(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-fuchsia-500"
                  />
                  <span>실행 시 역할 지침 자동 브리핑</span>
                </label>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAgentModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                취소
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-bold shadow"
              >
                에이전트 저장
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          모달 2: 에이전트 공유 메모장 (.ai-agents/BLACKBOARD.md) 편집 모달
         ===================================================================== */}
      {showBlackboardModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  [{selectedFolderName}] 에이전트 공유 메모장 (
                  <code>.ai-agents/BLACKBOARD.md</code>)
                </h3>
              </div>
              <button
                onClick={() => setShowBlackboardModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-400 leading-relaxed">
                여러 AI 에이전트가 서로 다른 터미널에서 동시에 작업할 때, 공통 목표·아키텍처 결정사항·작업 인수인계 내용을 함께 읽고 기록하는 이 프로젝트 전용 마크다운 메모장입니다.
              </p>
              <textarea
                rows={12}
                value={blackboardContent}
                onChange={(e) => setBlackboardContent(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-700 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyan-500 leading-relaxed"
              />
            </div>

            <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setShowBlackboardModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                닫기
              </button>
              <button
                onClick={handleSaveBlackboard}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow"
              >
                BLACKBOARD.md 저장
              </button>
            </div>
          </div>
        </div>
      )}



      {/* =====================================================================
          모달 3: 현재 프로젝트 출근 에이전트 전원에게 일괄 업무 지시 하달
         ===================================================================== */}
      {showDispatchModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleDispatchSubmit}
            className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-fuchsia-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  [{selectedFolderName}] 가동 에이전트 전체(
                  {currentProjectSessions.length}명)에게 일괄 지시 하달
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDispatchModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-400">
                현재 <b>{selectedFolderName}</b> 프로젝트에서 가동 중인 모든 에이전트 터미널에 동일한 업무 지시를 동시에 전송합니다. 각 에이전트는 자신의 역할(PM/백엔드/UI/QA)에 맞춰 작업을 수행합니다.
              </p>
              <textarea
                rows={4}
                value={dispatchTaskText}
                onChange={(e) => setDispatchTaskText(e.target.value)}
                placeholder="예: .ai-agents/BLACKBOARD.md의 요구사항을 읽고 각자 맡은 역할(설계/백엔드/UI/테스트)에 따라 점검 결과를 보고하세요."
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-fuchsia-500 leading-relaxed"
                required
              />
            </div>

            <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDispatchModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                취소
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-bold shadow"
              >
                전체에게 동시 전송
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 모달 4: 프로젝트 그룹 설정 / 이동 모달 (테마 완벽 연동) */}
      {groupModalProjPath && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center text-white shadow-sm">
                  <Tag className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">프로젝트 그룹 변경</h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    프로젝트의 소속 그룹을 변경하거나 새로 지정합니다.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGroupModalProjPath(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block mb-1">선택 프로젝트:</span>
                <div className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-bold text-slate-800 dark:text-slate-200 truncate font-mono text-[11px]">
                  📁 {getShortFolderName(groupModalProjPath)}
                </div>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 mb-1.5 font-semibold">
                  기존 그룹 선택
                </label>
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {allGroupNames.map((gName) => (
                    <button
                      key={gName}
                      type="button"
                      onClick={() => handleSetProjectGroup(groupModalProjPath, gName)}
                      className="w-full text-left px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500 text-slate-700 dark:text-slate-200 text-xs flex items-center justify-between transition group/btn"
                    >
                      <span className="truncate">{gName}</span>
                      <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-semibold group-hover/btn:translate-x-0.5 transition-transform">이동 →</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 mb-1.5 font-semibold">
                  또는 새 그룹 직접 입력
                </label>
                <div className="flex gap-1.5">
                  <input
                    value={targetGroupName}
                    onChange={(e) => setTargetGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && targetGroupName.trim()) {
                        e.preventDefault();
                        handleCreateNewGroup(targetGroupName.trim(), groupModalProjPath);
                      }
                    }}
                    placeholder="예: 회사 업무, 개인 토이"
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:border-indigo-500 shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (targetGroupName.trim()) {
                        handleCreateNewGroup(targetGroupName.trim(), groupModalProjPath);
                      }
                    }}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shrink-0 shadow-sm transition"
                  >
                    지정
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setGroupModalProjPath(null)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 모달 4-1: 새 프로젝트 그룹 추가 모달 (화면 중앙 & 다크/라이트 테마 완벽 연동) */}
      {isNewGroupModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center text-white shadow-sm">
                  <FolderTree className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    새 프로젝트 그룹 추가
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    프로젝트를 체계적으로 분류하고 관리할 새 그룹을 만듭니다.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewGroupModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 본문 폼 */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateNewGroup(newGroupNameInput, selectedProjectForNewGroup || undefined);
              }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  그룹 이름 <span className="text-indigo-500 font-bold">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newGroupNameInput}
                  onChange={(e) => setNewGroupNameInput(e.target.value)}
                  placeholder="예: 회사 업무, 사이드 프로젝트, 연구, 토이"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm transition"
                />
              </div>

              {/* 추천 태그 칩 */}
              <div>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1.5 font-medium">
                  추천 그룹명 빠른 입력:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {["💼 회사 업무", "🚀 사이드 프로젝트", "🔬 연구 및 학습", "🛠️ 오픈소스"].map(
                    (tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setNewGroupNameInput(tag.replace(/^[^\s]+\s/, ""))}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 text-[11px] text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300 transition"
                      >
                        {tag}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* 프로젝트 배정 (선택 사항) */}
              {projectFolders.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    이 그룹에 바로 할당할 프로젝트 (선택 사항)
                  </label>
                  <select
                    value={selectedProjectForNewGroup}
                    onChange={(e) => setSelectedProjectForNewGroup(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:border-indigo-500 shadow-sm cursor-pointer transition"
                  >
                    <option value="">(선택 안 함 - 빈 그룹으로 생성)</option>
                    {projectFolders.map((p) => (
                      <option key={p.path} value={p.path}>
                        📁 {getShortFolderName(p.path)} ({p.path})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 모달 푸터 버튼 */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewGroupModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={!newGroupNameInput.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-indigo-600/20 transition flex items-center gap-1.5"
                >
                  <FolderTree className="w-3.5 h-3.5" />
                  <span>그룹 생성</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* 모달 5: 세션 보호 및 시스템 트레이 / 종료 선택 모달 */}
      {showExitConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 select-none">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-slate-100">AgentriX 종료 / 최소화 확인</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowExitConfirmModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 leading-relaxed">
                현재 <b>{sessions.length}개</b>의 AI CLI 세션이 백그라운드에서 동작 중입니다.
                완전히 종료하면 실행 중인 터미널 세션이 함께 중단됩니다.
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleMinimizeToTray}
                  className="w-full p-3 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/50 text-indigo-100 text-left transition flex items-center justify-between group"
                >
                  <div>
                    <div className="font-bold text-xs flex items-center gap-1.5 text-indigo-300">
                      <span>시스템 트레이로 숨기기 (권장)</span>
                      <span className="px-1.5 py-0.5 rounded bg-indigo-500/30 text-[10px] font-semibold text-indigo-200">
                        추천
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      터미널 작업을 유지하고 쿼터 리셋/소진 알림을 계속 받습니다
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-indigo-400 group-hover:translate-x-0.5 transition" />
                </button>

                <button
                  type="button"
                  onClick={handleConfirmExitAll}
                  className="w-full p-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-200 text-left transition flex items-center justify-between group"
                >
                  <div>
                    <div className="font-bold text-xs text-rose-300">세션 모두 종료 후 완전 닫기</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      실행 중인 {sessions.length}개 세션을 정리하고 프로그램을 완전히 종료합니다
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-rose-400 group-hover:translate-x-0.5 transition" />
                </button>
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowExitConfirmModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                취소 (창 유지)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 모달 5: 토큰 최적화 및 스마트 자동 세션 릴레이(Handoff) 설정 모달 */}
      <TokenOptimizationModal
        isOpen={showTokenOptModal}
        onClose={() => setShowTokenOptModal(false)}
        config={tokenOptConfig}
        onSaveConfig={handleSaveTokenOptConfig}
        onManualTriggerRelay={() => {
          if (activeSessionId) {
            handleAutoRelaySession(activeSessionId, true);
            setShowTokenOptModal(false);
          }
        }}
        activeSessionName={sessions.find((s) => s.id === activeSessionId)?.name}
        activeSessionEstTokens={activeSessionId ? (sessionTokens[activeSessionId] || 0) : 0}
      />

      {/* 모달 6: AI 심층 팀빌딩 & AI 엔진 연동 설정 모달 */}
      <AiDeepTeamModal
        isOpen={showAiDeepModal}
        onClose={() => setShowAiDeepModal(false)}
        projectPath={selectedProjectPath}
        projectName={getShortFolderName(selectedProjectPath)}
        projectContext={projectDeepContext}
        savedApiKeys={apiKeys}
        onApplyDeepAgents={handleApplyDeepAgents}
      />

      {/* 모달 7: 앱 테마와 100% 동기화되는 Agentrix 전용 프로젝트 폴더 선택 모달 */}
      <FolderPickerModal
        isOpen={isFolderPickerOpen}
        onClose={() => setIsFolderPickerOpen(false)}
        onSelectFolder={handleFolderPickerSelect}
        initialPath={selectedProjectPath}
        themeMode={themeMode}
      />

      {/* 우측 하단 알림 토스트 (고대비 가독성 극대화 및 직관적 상태 아이콘) */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 shadow-2xl text-xs font-semibold backdrop-blur-md transition-all ${
            toast.tone === "error"
              ? "bg-slate-900 text-white border-rose-500 shadow-rose-950/50"
              : toast.tone === "success"
              ? "bg-slate-900 text-white border-emerald-500 shadow-emerald-950/50"
              : "bg-slate-900 text-white border-indigo-500 shadow-indigo-950/50"
          }`}
        >
          {toast.tone === "error" ? (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : toast.tone === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
          )}
          <span className="text-white tracking-wide">{toast.text}</span>
        </div>
      )}
    </div>
  );
};

export default App;
