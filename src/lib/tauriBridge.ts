import { invoke } from "@tauri-apps/api/core";

export async function apiCheckNpmCliUpdates(): Promise<Record<string, { current: string; latest: string }>> {
  return invoke("check_npm_cli_updates");
}

export async function apiInstallNpmCliUpdate(packageName: string): Promise<void> {
  return invoke("install_npm_cli_update", { package: packageName });
}
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getUserInputVersion, getLastSubmission, hasPendingSessionInput, recordSessionInput, recordSessionSubmission } from "./inputHistory";
import { applyHandoffHint, getRoleState, markRolePrefix, restoreHandoffHint } from "./handoffRelay";
import { roleBriefText } from "./blackboardDispatch";
import { useAppStore } from "./store";
import { enterReady, needsEnterRetry, pasteWrap, queueSessionWrite, submissionStarted } from "./sessionWriteQueue";

const AGY_FULL_BODY_RETRY_TIMEOUT_MS = 10_000;
const agyFullBodyRetried = new Set<string>(); // 세션·본문별 retry_full_body 사용 기록(앱 실행 중 유지)
import type { DeliveryAttempt } from "./deliveryAttempt";
import { menuScreen, codexPastePending, CursorBusyError, cursorPastedSubmission, cursorTurnBusy, readCursorTurn, readTerminalScreen, setTerminalScreen } from "./cursorScreen";
import { AGY_IDLE_FALLBACK_MS, idleScreenFallback } from "./deliveryGate";
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

export async function apiListDirectoryEntries(
  path?: string,
  includeFiles: boolean = false
): Promise<DirectoryListing | null> {
  if (isTauriRuntime()) {
    return invoke<DirectoryListing>("list_directory_entries", {
      path,
      includeFiles,
    });
  }
  return null;
}

export async function apiReadFileAsBase64(path: string): Promise<string | null> {
  if (isTauriRuntime() && path) {
    try {
      return await invoke<string>("read_file_as_base64", { path });
    } catch (err) {
      console.warn("Base64 읽기 오류:", err);
      return null;
    }
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

export async function apiGetCliEffortOptions(): Promise<Record<string, string[]>> {
  return isTauriRuntime() ? invoke("get_cli_effort_options") : {};
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

export async function apiCancelProjectBlackboardTask(projectPath: string, taskId: string): Promise<void> {
  if (!isTauriRuntime() || !projectPath.trim()) throw new Error("프로젝트 작업판을 사용할 수 없습니다.");
  return invoke("cancel_project_blackboard_task", { projectPath, taskId });
}

export async function apiStartProjectBlackboardTask(projectPath: string, taskId: string): Promise<void> {
  if (!isTauriRuntime() || !projectPath.trim()) throw new Error("프로젝트 작업판을 사용할 수 없습니다.");
  return invoke("start_project_blackboard_task", { projectPath, taskId });
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

export async function apiRequestWithDetectedCredential(credential: DetectedCliCredential, model: string, body: unknown): Promise<unknown> {
  return invoke("request_with_detected_credential", { credential, model, body });
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

export async function apiListCliModels(cliId: string): Promise<string[]> {
  if (isTauriRuntime()) return invoke<string[]>("list_cli_models", { cliId });
  return [];
}

export async function apiStartSession(
  cliId: string,
  cwd?: string,
  initialCommand?: string,
  agentId?: string,
  model?: string,
  permissionArgs?: string[],
  permissionAuto?: boolean,
  suppressBrief?: boolean,
  collabProtocol?: string,
  startFresh?: boolean
): Promise<SessionInfo> {
  if (isTauriRuntime()) {
    return invoke<SessionInfo>("start_session", {
      cliId,
      cwd: cwd ?? null,
      initialCommand: initialCommand ?? null,
      agentId: agentId ?? null,
      model: model || null,
      permissionArgs: permissionArgs ?? null,
      permissionAuto: permissionAuto ?? false,
      suppressBrief: suppressBrief ?? false,
      collabProtocol: collabProtocol ?? null,
      startFresh: startFresh ?? false,
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

export class SubmissionUnconfirmedError extends Error {
  constructor() { super("보냈지만 제출을 확인하지 못했습니다."); this.name = "SubmissionUnconfirmedError"; }
}

export function isRawUserKey(data: string, injected: boolean, verify?: unknown, roleBriefing = false): boolean {
  return !injected && !verify && !roleBriefing && (data.length <= 1 || data.startsWith("\x1b"));
}

export async function apiWriteTerminalBinary(sessionId: string, data: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("write_to_session_bytes", { sessionId, data: Array.from(data, (char) => char.charCodeAt(0)) });
}

export async function apiWriteToSession(sessionId: string, data: string, injected = false, verify?: { hasStarted: () => Promise<boolean | null>; onResult: (confirmed: boolean) => void; onlyPendingRole?: boolean; onSkip?: () => void; attempt?: DeliveryAttempt; onCommit?: (body: string, at: number) => void; allowAgyRetry?: boolean; allowRetry?: boolean }, roleBriefing = false): Promise<void> {
  recordSessionInput(sessionId, data, injected, false);
  const inputVersion = getUserInputVersion(sessionId);
  // 사용자가 직접 누른 키·방향키·휠(마우스 보고)은 진행 중인 팀 전달(agy는 최대 30초+재시도)의 쓰기 대기열 뒤에 서지 않는다:
  // 줄 서면 agy 탭에서 스크롤·타이핑이 먹통처럼 보인다. 전달은 사용자 입력 버전이 바뀌면 Enter 전에 스스로 중단된다.
  if (isRawUserKey(data, injected, verify, roleBriefing) && isTauriRuntime()) {
    await invoke("write_to_session", { sessionId, data });
    if (/[\r\n]/.test(data)) recordSessionSubmission(sessionId);
    return;
  }
  return queueSessionWrite(sessionId, async () => {
    verify?.attempt?.check();
    const session = useAppStore.getState().sessions.find((s) => s.id === sessionId);
    if (verify?.onlyPendingRole && getRoleState(sessionId) !== "pending") {
      verify.onSkip?.();
      return;
    }
    const submission = data.length > 1 && /\r\n?$/.test(data) && !data.startsWith("/") && !data.startsWith("\x1b");
    if (submission && session?.agentId && session.rolePrompt && !session.roleInSystem && !getRoleState(sessionId)) {
      const agents = await apiGetProjectAgents(session.cwd);
      const agent = agents.find((a) => a.id === session.agentId);
      if (agent?.autoBrief && agent.rolePrompt.trim()) {
        markRolePrefix(sessionId, roleBriefText(agent, agents, Boolean(await apiReadFileAsBase64(`${session.cwd}/.ai-agents/agents/${agent.id}/ROLE.md`))));
      }
    }
    const original = data;
    verify?.attempt?.check();
    const roleWasPending = getRoleState(sessionId) === "pending";
    data = applyHandoffHint(sessionId, data);
    const prefix = data !== original ? data.slice(0, data.length - original.length) : "";
    const roleText = session?.rolePrompt?.replace(/[\r\n]+/g, " ").trim();
    if (roleBriefing && roleWasPending && roleText && prefix.includes(roleText)) data = prefix.replace(roleText, "") + original;
    let restored = false;
    let bodyWritten = false;
    // agy는 본문이 입력창에 들어간 뒤(마감 시간 초과·중단 포함)에는 접두를 되살리지 않는다 — 되살리면 3초 틱이 역할 지침만 계속 다시 넣음
    const restore = () => { if (!restored && prefix && !(session?.cliId === "antigravity" && bodyWritten)) { restoreHandoffHint(sessionId, prefix, roleWasPending); restored = true; } };
    try {
  if (isTauriRuntime()) {
    // TUI(Claude/Codex 등)는 "텍스트+\r" 한 덩어리를 붙여넣기로 인식해 Enter를 줄바꿈으로 삼킨다.
    // 텍스트를 먼저 쓰고 붙여넣기 처리가 끝난 뒤 Enter를 별도 키 입력으로 보낸다. (단일 키 입력은 그대로 통과)
    // 긴 글·여러 줄(Shift+Enter)일수록 TUI가 붙여넣기를 소화하는 시간이 길어 대기도 늘린다.
    const body = data.replace(/\r\n?$/, "");
    if (body !== data && body.length > 0) {
        const internalVerify = submission && !verify;
        if (submission && !verify) {
          const baselineAt = Date.now();
          const initial = session ? await apiGetSessionContext(session, []).catch(() => null) : null;
          verify = {
            hasStarted: async () => {
              if (!session) return null;
              const current = await apiGetSessionContext(session, []).catch(() => null);
              if (!current?.startedAt || (initial && current.source !== initial.source)) return null;
              return current.startedAt > (initial?.startedAt ?? baselineAt);
            },
            onResult: () => {},
          };
        }
        if (verify && getUserInputVersion(sessionId) !== inputVersion) {
          restore(); verify.onResult(false);
          if (internalVerify) throw new Error("사용자 입력으로 전달이 중단되었습니다.");
          return;
        }
      const sentAt = Date.now();
      if (session && ["cursor", "codex"].includes(session.cliId)) await refreshTerminalScreen(sessionId);
      const cursorBefore = session?.cliId === "cursor" ? readTerminalScreen(sessionId) : null;
        const pasteMode = await invoke<boolean | null>("get_session_paste_mode", { sessionId }).catch(() => null);
      const cursorAtWrite = session?.cliId === "cursor" ? readTerminalScreen(sessionId) : null;
      if (session?.cliId === "cursor") {
        const quiet = await apiGetSessionQuietSince(sessionId, 3000).catch(() => null);
        if (!cursorAtWrite || !quiet || !readCursorTurn(sessionId, quiet)?.completedAt) {
          const screen = await apiGetSessionScreen(sessionId, 30).catch(() => null);
          const idleSince = await apiGetSessionQuietSince(sessionId, AGY_IDLE_FALLBACK_MS).catch(() => null);
          if ((cursorAtWrite && cursorTurnBusy(cursorAtWrite)) || !idleScreenFallback("cursor", screen, idleSince, getLastSubmission(sessionId), hasPendingSessionInput(sessionId))) throw new CursorBusyError();
        }
      }
      if (verify && getUserInputVersion(sessionId) !== inputVersion) throw new Error("사용자 입력으로 전달이 중단되었습니다.");
        verify?.onCommit?.(body, Date.now());
        verify?.attempt?.commit();
      const wrapped = pasteWrap(body, pasteMode, session?.cliId);
      await invoke("write_to_session", { sessionId, data: wrapped });
      bodyWritten = true;
      verify?.attempt?.check();
      const lines = body.split("\n").length;
      const minWait = Math.min(1500, 200 + body.length + (lines > 1 ? 300 : 0));
      for (;;) {
        await new Promise((r) => setTimeout(r, 50));
        // quietMs 0 = 마지막 출력 시각
        const last = await invoke<number | null>("get_session_quiet_since", { sessionId, quietMs: 0 }).catch(() => null);
        verify?.attempt?.check();
        if (enterReady(sentAt, last, Date.now(), minWait)) break;
      }
      // Enter 직전 출력 끝 위치: 이후 출력만 보고 삼켜짐을 판정 (커서가 끝을 넘으면 nextCursor = 현재 끝)
    let endCursor = await invoke<PtyOutputChunk>("read_session_output", { sessionId, cursor: Number.MAX_SAFE_INTEGER }).then((c) => c.nextCursor).catch(() => null);
      verify?.attempt?.check();
      if (verify && getUserInputVersion(sessionId) !== inputVersion) {
        console.info(`[team-delivery] session=${sessionId} paste_mode=${pasteMode} write_at=${sentAt} enter_at=none output_bytes_2s=0 confirmed=false retries=0`);
        restore(); verify.onResult(false);
        if (internalVerify) throw new Error("사용자 입력으로 전달이 중단되었습니다.");
        return;
      }
      let enterAt = Date.now();
      verify?.attempt?.step("submit");
      await invoke("write_to_session", { sessionId, data: "\r" });
      recordSessionSubmission(sessionId);
      verify?.attempt?.check();
      if (verify) {
        verify.attempt?.step("confirm");
        let confirmed = false;
        let retries = 0;
        let outputBytes = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, attempt === 0 ? (session?.cliId === "antigravity" ? AGY_FULL_BODY_RETRY_TIMEOUT_MS : 2000) : 1000));
          const chunk = endCursor === null ? null : await invoke<PtyOutputChunk>("read_session_output", { sessionId, cursor: endCursor }).catch(() => null);
          const output = chunk?.data ?? "";
          if (attempt === 0 && chunk && endCursor !== null) outputBytes = Math.max(0, chunk.nextCursor - endCursor);
          if (session && ["cursor", "codex"].includes(session.cliId)) await refreshTerminalScreen(sessionId);
          const cursorNow = session?.cliId === "cursor" ? readTerminalScreen(sessionId) : null;
          const cursorConfirmed = cursorBefore !== null && cursorNow !== null &&
            ((!cursorTurnBusy(cursorBefore) && cursorTurnBusy(cursorNow)) || cursorPastedSubmission(cursorNow, cursorBefore));
          const logStarted = await verify.hasStarted().catch(() => false);
          const codexScreen = session?.cliId === "codex" ? readTerminalScreen(sessionId) : null;
          confirmed = cursorConfirmed || (session?.cliId === "cursor" ? logStarted === true : submissionStarted(output, logStarted, codexScreen !== null && codexPastePending(codexScreen)));
          // 메뉴 화면에서는 입력이 입력창에 들어가지 않았으므로 로그가 옛 턴을 가리켜도 성공으로 치지 않는다
          if (confirmed && await apiGetSessionScreen(sessionId, 30).then((sc) => menuScreen(sc?.lines)).catch(() => false)) confirmed = false;
          verify.attempt?.check();
        // agy 본문 전체 재전송은 같은 세션·같은 본문에 평생 1회(시도마다 반복하면 입력창에 같은 지침이 쌓임)
        const retryKey = `${sessionId} ${body}`;
        if (session?.cliId === "antigravity" && verify.allowAgyRetry !== false && !confirmed && attempt === 0 && !agyFullBodyRetried.has(retryKey)) {
          agyFullBodyRetried.add(retryKey);
          if (getUserInputVersion(sessionId) !== inputVersion) break;
          const retrySentAt = Date.now();
          verify.onCommit?.(body, retrySentAt);
          verify.attempt?.step("retry_full_body");
          await invoke("write_to_session", { sessionId, data: wrapped });
          let quietSince = await invoke<number | null>("get_session_quiet_since", { sessionId, quietMs: 0 }).catch(() => null);
          while (getUserInputVersion(sessionId) === inputVersion && !enterReady(retrySentAt, quietSince, Date.now(), minWait)) {
            await new Promise((r) => setTimeout(r, 50));
            verify.attempt?.check();
            quietSince = await invoke<number | null>("get_session_quiet_since", { sessionId, quietMs: 0 }).catch(() => null);
          }
          if (getUserInputVersion(sessionId) !== inputVersion) {
            restore();
            verify.onResult(false);
            break;
          }
          endCursor = await invoke<PtyOutputChunk>("read_session_output", { sessionId, cursor: Number.MAX_SAFE_INTEGER }).then((c) => c.nextCursor).catch(() => null);
          enterAt = Date.now();
          await invoke("write_to_session", { sessionId, data: "\r" });
          recordSessionSubmission(sessionId);
          verify.attempt?.check();
          retries++;
          continue;
        }
          if (session?.cliId === "antigravity" || verify.allowRetry === false || !needsEnterRetry(confirmed, getUserInputVersion(sessionId) !== inputVersion) || attempt === 2) break;
          if (getUserInputVersion(sessionId) !== inputVersion) break;
          await invoke("write_to_session", { sessionId, data: "\r" });
          retries++;
        }
        console.info(`[team-delivery] session=${sessionId} paste_mode=${pasteMode} write_at=${sentAt} enter_at=${enterAt} output_bytes_2s=${outputBytes} confirmed=${confirmed} retries=${retries}`);
        // agy는 본문이 이미 입력창에 들어간 뒤의 미확인이므로 접두(역할 지침)를 되살리지 않는다 — 되살리면 다음 전달마다 같은 지침이 또 붙는다.
        // 늦게 로그로 확인되면 confirmRestoredPrefix가 역할 상태를 확정한다.
        if (!confirmed && session?.cliId !== "antigravity") restore();
        verify.onResult(confirmed);
        if (!confirmed && internalVerify) throw new Error("제출 확인 실패: 입력창을 확인해 주세요.");
      }
      return;
    }
    await invoke("write_to_session", { sessionId, data });
    if (/[\r\n]/.test(data)) recordSessionSubmission(sessionId);
    return;
  }
  const prev = fallbackBuffers.get(sessionId) ?? "";
  verify?.attempt?.commit();
  fallbackBuffers.set(sessionId, prev + data);
  if (/[\r\n]/.test(data)) recordSessionSubmission(sessionId);
  fallbackListeners.forEach((cb) => cb({ sessionId, data }));
    } catch (error) { restore(); if (bodyWritten) throw new SubmissionUnconfirmedError(); throw error; }
  }, verify?.attempt?.cancelledPromise);
}

export interface TeamMail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}

const routingMail = new Map<string, Promise<TeamMail[]>>();
export async function apiRouteTeamMail(projectPath: string): Promise<TeamMail[]> {
  if (!isTauriRuntime()) return [];
  const pending = routingMail.get(projectPath);
  if (pending) return pending;
  const request = invoke<TeamMail[]>("route_team_mail", { projectPath }).finally(() => routingMail.delete(projectPath));
  routingMail.set(projectPath, request);
  return request;
}

export async function apiAcknowledgeTeamMail(projectPath: string, agentId: string, messageId: string): Promise<void> {
  if (isTauriRuntime()) await invoke("acknowledge_team_mail", { projectPath, agentId, messageId });
}

// CLI 로그에서 읽은 실제 컨텍스트 토큰. 로그가 없는 CLI(grok·cursor·새 CLI)나 브라우저 실행이면 null
export async function apiSessionUserMessageSubmitted(sessionId: string, body: string, after: number): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke("session_user_message_submitted", { sessionId, body, after });
}

export async function apiAgyMessageSubmitted(sessionId: string, body: string, after: number, claimed: string[], expectedSource: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke("session_user_message_submitted", { sessionId, body, after, claimed, expectedSource });
}

export async function apiGetSessionContext(
  session: SessionInfo,
  claimed: string[]
): Promise<{ tokens: number; window: number | null; source: string; completedAt: number | null; startedAt: number | null; sourceModifiedAt: number | null } | null> {
  if (!isTauriRuntime()) return null;
  return invoke("get_session_context", {
    cliId: session.cliId,
    sessionId: session.id,
    cwd: session.cwd,
    startedAt: session.startedAt,
    claimed,
  });
}

export async function apiGetSessionQuietSince(sessionId: string, quietMs?: number): Promise<number | null> {
  if (!isTauriRuntime()) return null;
  return invoke<number | null>("get_session_quiet_since", { sessionId, quietMs });
}

export interface PtyScreen {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
  rows: number;
  cols: number;
}

export async function apiGetSessionScreen(sessionId: string, lines?: number): Promise<PtyScreen | null> {
  if (!isTauriRuntime()) return null;
  return invoke<PtyScreen>("get_session_screen", { sessionId, lines });
}

// 판정 직전 백엔드 가상 화면을 사본에 반영(실패·미지원이면 이전 사본 유지)
export async function refreshTerminalScreen(sessionId: string): Promise<void> {
  const screen = await apiGetSessionScreen(sessionId, 30).catch(() => null);
  if (Array.isArray(screen?.lines)) setTerminalScreen(sessionId, screen.lines);
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
    // Tauri에서는 백엔드 검증(open_external_url)이 거부하면 에러를 그대로 던진다: window.open으로 우회하지 않는다
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank");
}

export interface UpdateProgressPayload {
  status: "downloading" | "installing" | "done" | "error";
  percent: number;
  downloaded_bytes: number;
  total_bytes: number;
  message: string;
}

export async function apiPerformInAppUpdate(downloadUrl: string): Promise<void> {
  if (isTauriRuntime()) {
    return invoke<void>("perform_in_app_update", { downloadUrl });
  }
}

export interface TokenToolStatus {
  id: string;
  name: string;
  installed: boolean;
  version: string | null;
  requires: string | null;
  requiresMet: boolean;
  installCommand: string;
}

export async function apiCheckTokenTools(): Promise<TokenToolStatus[]> {
  return invoke("check_token_tools");
}

export async function apiInstallTokenTool(toolId: string): Promise<{ ok: boolean; output: string }> {
  return invoke("install_token_tool", { toolId });
}

export async function apiCheckPluginUpdates(): Promise<Record<string, { current: string; latest: string }>> {
  return invoke("check_plugin_updates");
}

export async function apiUpdatePlugin(plugin: string): Promise<void> {
  return invoke("update_plugin", { plugin });
}
