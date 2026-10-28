import React, { useEffect, useState } from "react";
import { Select } from "./Select";
import { DEFAULT_CLI_FLAGS, loadPermSettings, savePermSettings, type PermMode } from "../lib/permissionSettings";
import {
  Bot,
  BrainCircuit,
  Check,
  ClipboardList,
  Code2,
  Edit3,
  FolderOpen,
  Play,
  Plus,
  Radio,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  UserPlus,
  Wand2,
  X,
} from "lucide-react";
import type {
  CliDefinition,
  ProjectAgentInput,
  ProjectAgentRecord,
  ProjectAnalysisResult,
  SessionInfo,
} from "../types/types";
import { SynapseGraphView } from "./SynapseGraphView";
import { ModelPicker, getCliDefaultModel, setCliDefaultModel } from "./ModelPicker";

// 일반 CLI 실행 시 사용할 기본 모델 (localStorage 저장)
const CliModelField: React.FC<{ cliId: string }> = ({ cliId }) => {
  const [model, setModel] = useState(() => getCliDefaultModel(cliId));
  return (
    <ModelPicker
      cliId={cliId}
      value={model}
      onChange={(m) => {
        setModel(m);
        setCliDefaultModel(cliId, m);
      }}
      className="w-full font-mono text-[11px] p-2 rounded-lg border bg-slate-950 text-emerald-300 border-slate-700 focus:outline-none focus:border-emerald-500/60"
    />
  );
};

interface ProjectWorkspaceViewProps {
  projectPath: string;
  analysis: ProjectAnalysisResult | null;
  agents: ProjectAgentRecord[];
  clis: CliDefinition[];
  runningSessions: SessionInfo[];
  onAddRecommendedAgent: (rec: ProjectAgentInput) => Promise<void>;
  onAddAllRecommended: (recs: ProjectAgentInput[]) => Promise<void>;
  onOpenCreateCustomAgent: () => void;
  onOpenEditAgent: (agent: ProjectAgentRecord) => void;
  onDeleteAgent: (agentId: string) => Promise<void>;
  onSpawnAgent: (agent: ProjectAgentRecord) => Promise<void>;
  onSpawnAllAgents: () => Promise<void>;
  onFocusSession: (sessionId: string) => void;
  onStartRawCli: (cliId: string, initialCommand?: string) => Promise<void>;
  onOpenBlackboard: () => void;
  onOpenDispatchModal: () => void;
  onOpenAiDeepModal?: () => void;
  onStartAutoRelay?: () => Promise<void>;
  onStartAutoRelayWithGoal?: (goal: string) => Promise<void>;
  onToggleAgentWrapper?: (agent: ProjectAgentRecord) => Promise<void>;
  onToggleAllAgentsWrapper?: (enable: boolean) => Promise<void>;
  onSendPromptToAgent?: (agentId: string, prompt: string) => Promise<void>;
  onTrustProjectFolder?: () => Promise<void>;
}

export const ProjectWorkspaceView: React.FC<ProjectWorkspaceViewProps> = ({
  projectPath,
  analysis,
  agents,
  clis,
  runningSessions,
  onAddRecommendedAgent,
  onAddAllRecommended,
  onOpenCreateCustomAgent,
  onOpenEditAgent,
  onDeleteAgent,
  onSpawnAgent,
  onSpawnAllAgents,
  onFocusSession,
  onStartRawCli,
  onOpenBlackboard,
  onOpenDispatchModal,
  onOpenAiDeepModal,
  onStartAutoRelay,
  onStartAutoRelayWithGoal,
  onToggleAgentWrapper,
  onToggleAllAgentsWrapper,
  onSendPromptToAgent,
  onTrustProjectFolder,
}) => {
  const [workspaceDisplayMode, setWorkspaceDisplayMode] = useState<"cards" | "synapse">("cards");
  const [recCliOverrides, setRecCliOverrides] = useState<Record<string, string>>({});
  const [recWrapperOverrides, setRecWrapperOverrides] = useState<Record<string, boolean>>({});
  const [recModelOverrides, setRecModelOverrides] = useState<Record<string, string>>({});
  const [showAutoRelayModal, setShowAutoRelayModal] = useState(false);
  const [relayGoalInput, setRelayGoalInput] = useState("");
  const [showPermissionSettings, setShowPermissionSettings] = useState(false);
  const [permMode, setPermMode] = useState<PermMode>(() => loadPermSettings().mode);
  const [cliFlags, setCliFlags] = useState<Record<string, string>>(() => loadPermSettings().flags);
  useEffect(() => savePermSettings(permMode, cliFlags), [permMode, cliFlags]);
  const [trustSaved, setTrustSaved] = useState(false);

  const handleTrustClick = async () => {
    if (onTrustProjectFolder) {
      await onTrustProjectFolder();
      setTrustSaved(true);
      setTimeout(() => setTrustSaved(false), 3000);
    }
  };

  const projectName =
    analysis?.projectName ||
    projectPath.split(/[/\\]/).filter(Boolean).pop() ||
    "Project";

  const recommendations = analysis?.recommendedAgents ?? [];

  const isRecAlreadyAdded = (rec: ProjectAgentInput) => {
    return agents.some(
      (a) =>
        (rec.id && a.id === rec.id) ||
        a.name.toLowerCase() === rec.name.toLowerCase()
    );
  };

  const unaddedRecommendations = recommendations.filter(
    (r) => !isRecAlreadyAdded(r)
  );

  const allHeadroomActive = agents.length > 0 && agents.every((a) => a.useWrapper);

  const handleTriggerAutoRelay = () => {
    setShowAutoRelayModal(true);
  };

  const handleSubmitAutonomousRelay = async () => {
    if (!relayGoalInput.trim()) {
      if (onStartAutoRelay) {
        await onStartAutoRelay();
      }
    } else {
      if (onStartAutoRelayWithGoal) {
        await onStartAutoRelayWithGoal(relayGoalInput.trim());
      } else if (onStartAutoRelay) {
        await onStartAutoRelay();
      }
    }
    setShowAutoRelayModal(false);
    setRelayGoalInput("");
  };

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 space-y-6 pb-24 bg-slate-950">
      {/* =====================================================================
          1. 최상단: 프로젝트 헤더 & 에이전트 없이 일반 CLI 바로 열기
         ===================================================================== */}
      <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                <FolderOpen className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <span>{projectName}</span>
                </h2>
                <p className="text-xs font-mono text-slate-400 break-all">
                  {projectPath}
                </p>
              </div>
            </div>

            {analysis && analysis.detectedStacks.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[11px] text-slate-400 flex items-center gap-1 mr-1">
                  <Code2 className="w-3.5 h-3.5 text-indigo-400" />
                  감지된 기술 스택:
                </span>
                {analysis.detectedStacks.map((stack) => (
                  <span
                    key={stack}
                    className="px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold"
                  >
                    {stack}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 최상단 바로 실행 바: 에이전트 역할 부여 없이 순수 CLI 터미널 즉시 열기 */}
        <div className="pt-3 border-t border-slate-800/90 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-400 dark:text-indigo-300 flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-indigo-400" />
              에이전트 없이 일반 CLI 바로 열기 ({projectName} 폴더에서 즉시 실행)
            </span>
          </div>

        {/* 권한 & 자율 연동 상태 바 (모드 선택 및 도구별 플래그 직접 설정) */}
        <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/90 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300">
                일반 CLI 실행 권한 모드:{" "}
                <strong className="text-emerald-300 font-bold">
                  {permMode === "full_auto"
                    ? "⚡ 도구별 맞춤 자동 승인 (Full-Auto)"
                    : permMode === "manual"
                    ? "🛡️ 수동 확인 모드 (질문 허용)"
                    : "⚙️ 사용자 직접 편집 모드"}
                </strong>
              </span>
              <span className="text-slate-500 hidden sm:inline">
                {permMode === "full_auto"
                  ? "— 지원되는 CLI에 자동 승인 설정을 전달합니다"
                  : permMode === "manual"
                  ? "— 실행 권한 스킵 플래그를 붙이지 않고 매 실행 시 확인합니다"
                  : "— 사용자가 직접 수정한 도구별 플래그를 적용합니다"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* 폴더 전체 신뢰 등록 원클릭 버튼 */}
              {onTrustProjectFolder && (
                <button
                  type="button"
                  onClick={handleTrustClick}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold transition ${
                    trustSaved
                      ? "bg-emerald-600/30 text-emerald-300 border-emerald-500/50"
                      : "bg-slate-900 hover:bg-emerald-500/15 text-slate-300 hover:text-emerald-300 border-slate-700 hover:border-emerald-500/40"
                  }`}
                  title="Claude 및 CLI 설정 파일에 이 프로젝트 폴더를 신뢰 목록(trusted: true)으로 등록하여 폴더 신뢰 질문(Trust this folder?)을 일체 스킵합니다"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  {trustSaved ? "✓ 폴더 신뢰 등록 완료!" : "🛡️ 폴더 전체 신뢰 등록 (Trust All)"}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowPermissionSettings((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-slate-700 text-xs font-mono transition"
              >
                <Settings2 className="w-3.5 h-3.5" />
                {showPermissionSettings ? "설정 닫기" : "권한 플래그 설정"}
              </button>
            </div>
          </div>

          {showPermissionSettings && (
            <div className="pt-3 border-t border-slate-800/80 space-y-3 text-slate-400">
              {/* 모드 선택 라디오 탭 */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-slate-200">
                  권한 실행 모드 설정:
                </span>
                <div className="flex rounded-lg bg-slate-900 p-1 border border-slate-800 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setPermMode("full_auto")}
                    className={`px-3 py-1 rounded-md transition ${
                      permMode === "full_auto"
                        ? "bg-emerald-600 text-white font-bold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    ⚡ 완전 자동 (Full-Auto)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPermMode("manual")}
                    className={`px-3 py-1 rounded-md transition ${
                      permMode === "manual"
                        ? "bg-indigo-600 text-white font-bold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    🛡️ 수동 확인 (질문 허용)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPermMode("custom")}
                    className={`px-3 py-1 rounded-md transition ${
                      permMode === "custom"
                        ? "bg-fuchsia-600 text-white font-bold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    ⚙️ 직접 수정 (Custom)
                  </button>
                </div>
              </div>

              {/* 도구별 개별 플래그 설정 / 수정 입력창 (등록된 모든 CLI 동적 표시) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 text-xs max-h-[300px] overflow-y-auto pr-1">
                {(clis.length > 0 ? clis : [
                  { id: "claude", name: "Claude Code", provider: "Anthropic" },
                  { id: "codex", name: "Codex CLI", provider: "OpenAI" },
                  { id: "grok", name: "Grok CLI", provider: "xAI" },
                  { id: "antigravity", name: "Antigravity", provider: "Google" },
                  { id: "cursor", name: "Cursor Agent", provider: "Anysphere" },
                  { id: "opencode", name: "OpenCode", provider: "OpenCode" },
                ]).filter((cli) => cli.id !== "powershell" && cli.id !== "cmd").map((cli) => {
                  // 셸(PowerShell/CMD)은 승인 개념이 없어 제외, 알려지지 않은 CLI는 빈 플래그(직접 수정 모드에서 입력)
                  const defaultInfo = DEFAULT_CLI_FLAGS[cli.id] || {
                    flag: "",
                    desc: "알려진 자동 승인 플래그 없음 — 직접 수정에서 입력",
                  };
                  const currentVal =
                    permMode === "manual"
                      ? ""
                      : permMode === "full_auto"
                      ? defaultInfo.flag
                      : (cliFlags[cli.id] ?? defaultInfo.flag);

                  return (
                    <div
                      key={cli.id}
                      className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="font-bold text-slate-200 truncate">{cli.name}</span>
                          <span className="text-[10px] text-indigo-400 font-semibold shrink-0">
                            {('provider' in cli && cli.provider) || cli.id}
                          </span>
                        </div>
                        <input
                          value={currentVal}
                          disabled={permMode !== "custom"}
                          onChange={(e) =>
                            setCliFlags((prev) => ({
                              ...prev,
                              [cli.id]: e.target.value,
                            }))
                          }
                          placeholder={
                            permMode === "manual"
                              ? "스킵 없음 (질문 허용)"
                              : defaultInfo.flag
                          }
                          className={`w-full font-mono text-[11px] p-2 rounded-lg border focus:outline-none transition ${
                            permMode === "custom"
                              ? "bg-slate-950 text-indigo-300 border-indigo-500/50"
                              : "bg-slate-950/60 text-slate-400 border-slate-800 cursor-not-allowed"
                          }`}
                        />
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">{defaultInfo.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-2.5">
            {clis.map((cli) => {
              const isApplied = Boolean(cli.wrapperBinary);

              return (
                <div
                  key={cli.id}
                  className="p-1.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition space-y-1.5 shadow-sm"
                >
                <div className="flex items-center justify-between gap-1.5">
                  <button
                    onClick={() => onStartRawCli(cli.id, undefined)}
                    className="inline-flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/60 text-slate-100 text-xs font-semibold transition min-w-0 truncate flex-1"
                    title={`${cli.name} 일반 CLI 즉시 실행`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: cli.accentColor }}
                    />
                    <span className="truncate">{cli.name}</span>
                  </button>
                  {isApplied ? (
                    <button
                      onClick={() => onStartRawCli(cli.id, "__WRAPPER__")}
                      className="px-2 py-1 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-xs font-bold transition flex items-center gap-1 shadow-sm shrink-0"
                      title={cli.id === "opencode" ? "Headroom 래퍼로 실행합니다. 사용자 지정 API 공급자의 프록시 지원은 Headroom 버전에 따라 다릅니다." : `${cli.name}을(를) Headroom 토큰 최적화 모드로 즉시 실행`}
                    >
                      <Sparkles className="w-3 h-3 text-emerald-400" />
                      Headroom
                    </button>
                  ) : <span className="text-[10px] text-slate-500" title="지원되는 Headroom 실행 파일이나 CLI 래퍼가 감지되지 않았습니다">Headroom 미감지</span>}
                </div>
                <CliModelField cliId={cli.id} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* =====================================================================
          2. 중단: 전담 역할 에이전트 팀 & 시냅스 협업 지도
         ===================================================================== */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Bot className="w-4 h-4 text-fuchsia-400" />
                [{projectName}] 전담 역할 에이전트 ({agents.length}명)
              </h3>
              <div className="text-xs text-slate-400 mt-1 space-y-0.5">
                <p>· 사용자는 총괄 PM에게만 지시하며, 에이전트들이 서로 대화를 주고받으며 협업합니다.</p>
                <p>· [무인 자율 협업 가동] 시 사용자 확인 질문 없이 즉시 연동됩니다.</p>
              </div>
            </div>

            {/* 보기 전환 탭: 팀 카드 vs 시냅스 지도 */}
            <div className="flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs font-medium">
              <button
                onClick={() => setWorkspaceDisplayMode("cards")}
                className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                  workspaceDisplayMode === "cards"
                    ? "bg-indigo-600 text-white font-bold shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Bot className="w-3.5 h-3.5" />
                역할 팀 카드
              </button>
              <button
                onClick={() => setWorkspaceDisplayMode("synapse")}
                className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                  workspaceDisplayMode === "synapse"
                    ? "bg-fuchsia-600 text-white font-bold shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <BrainCircuit className="w-3.5 h-3.5 text-cyan-300" />
                🧠 시냅스 협업 지도
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onOpenBlackboard}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium transition"
              title="에이전트 공유 마크다운 메모장(.ai-agents/BLACKBOARD.md)을 엽니다."
            >
              <ClipboardList className="w-3.5 h-3.5 text-cyan-400" />
              에이전트 공유 메모장
            </button>

            {runningSessions.length > 0 && (
              <button
                onClick={onOpenDispatchModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-fuchsia-600/20 hover:bg-fuchsia-600/30 text-fuchsia-200 border border-fuchsia-500/40 text-xs font-bold transition"
              >
                <Send className="w-3.5 h-3.5" />
                동시 지시 ({runningSessions.length})
              </button>
            )}

            {/* 전체 Headroom 일괄 토글 버튼 */}
            {agents.length > 0 && onToggleAllAgentsWrapper && (
              <button
                onClick={() => onToggleAllAgentsWrapper(!allHeadroomActive)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition ${
                  allHeadroomActive
                    ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30"
                    : "bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-700"
                }`}
                title="현재 프로젝트의 모든 에이전트를 Headroom 토큰 절약 래퍼로 감싸서 실행합니다"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                전체 Headroom {allHeadroomActive ? "ON" : "OFF"}
              </button>
            )}

            {agents.length > 0 && (
              <>
                <button
                  onClick={handleTriggerAutoRelay}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white text-xs font-bold shadow-lg transition whitespace-nowrap shrink-0"
                  title="총괄 PM에게 목표를 내리면 에이전트 간 서로 대화하며 무인으로 작업을 자율 수행합니다"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  ⚡ 무인 자율 협업 가동
                </button>
                <button
                  onClick={onSpawnAllAgents}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow transition whitespace-nowrap shrink-0"
                  title="현재 프로젝트에 편성된 모든 AI 에이전트 터미널을 한 번에 가동합니다 (앱 재실행 후 원클릭 세션 복원)"
                >
                  <Play className="w-3.5 h-3.5" />
                  팀 전원 일괄 출근 (세션 가동)
                </button>
              </>
            )}

            <button
              onClick={onOpenCreateCustomAgent}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              직접 에이전트 추가
            </button>
          </div>
        </div>

        {/* 메인 뷰: 시냅스 지도 또는 카드 목록 */}
        {workspaceDisplayMode === "synapse" ? (
          <SynapseGraphView
            projectPath={projectPath}
            projectName={projectName}
            agents={agents}
            clis={clis}
            runningSessions={runningSessions}
            onSpawnAgent={onSpawnAgent}
            onFocusSession={onFocusSession}
            onOpenBlackboard={onOpenBlackboard}
            onSendPromptToAgent={onSendPromptToAgent || (async () => {})}
          />
        ) : agents.length === 0 ? (
          <div className="p-5 rounded-xl bg-slate-950/70 border border-dashed border-slate-800 text-center space-y-1.5">
            <p className="text-xs text-slate-300 font-medium">
              현재 배정된 역할 에이전트가 없습니다.
            </p>
            <p className="text-xs text-slate-500">
              단일 CLI만 쓰실 경우 위쪽의 <b>[일반 CLI 바로 열기]</b>를 누르시면 되고, 역할별 에이전트가 필요하면 아래 <b>[맞춤 에이전트 추천]</b>에서 골라 추가하세요.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {agents.map((agent) => {
              const running = runningSessions.find(
                (s) => s.agentId === agent.id
              );
              const cliDef = clis.find((c) => c.id === agent.cliId);

              return (
                <div
                  key={agent.id}
                  className={`p-4 rounded-xl border flex flex-col justify-between gap-3 transition ${
                    running
                      ? "bg-fuchsia-950/20 border-fuchsia-500/50 shadow-md"
                      : "bg-slate-950/90 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-2xl shrink-0">
                          {agent.avatarEmoji}
                        </span>
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-slate-100 truncate">
                            {agent.name}
                          </div>
                          <div className="text-xs font-semibold text-fuchsia-300 truncate">
                            {agent.roleTitle}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => onOpenEditAgent(agent)}
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-100 border border-slate-800 transition"
                          title="역할 및 CLI 엔진 수정"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteAgent(agent.id)}
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-500/15 text-slate-400 hover:text-rose-400 border border-slate-800 transition"
                          title="이 프로젝트에서 제외"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-indigo-300 border border-slate-800 text-[10px] font-mono font-semibold uppercase">
                        {cliDef?.name ?? agent.cliId}
                      </span>

                      {/* Headroom 감싸기 토글 버튼 */}
                      <button
                        type="button"
                        onClick={() => onToggleAgentWrapper && onToggleAgentWrapper(agent)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition border flex items-center gap-1 ${
                          agent.useWrapper
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                            : "bg-slate-900 text-slate-400 border-slate-800 hover:text-emerald-300 hover:border-emerald-500/30"
                        }`}
                        title="클릭하여 이 에이전트의 Headroom 토큰 최적화 래퍼를 켭니다/끕니다"
                      >
                        <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                        Headroom: {agent.useWrapper ? "ON" : "OFF"}
                      </button>

                      {running && (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                          ● 실행 중
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-1 max-h-32 overflow-y-auto">
                      {agent.rolePrompt
                        .split(/(?<=[.!?])\s+/)
                        .filter(Boolean)
                        .map((sentence, sIdx) => (
                          <p key={sIdx} className="leading-relaxed">
                            {sentence}
                          </p>
                        ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80">
                    {running ? (
                      <button
                        onClick={() => onFocusSession(running.id)}
                        className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow"
                      >
                        터미널 화면으로 이동 →
                      </button>
                    ) : (
                      <button
                        onClick={() => onSpawnAgent(agent)}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow"
                      >
                        <Play className="w-3.5 h-3.5" />
                        에이전트 실행
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* =====================================================================
          3. 하단: 프로젝트 맞춤 에이전트 추천 (원하는 역할만 선택적으로 추가)
         ===================================================================== */}
      <div className="rounded-2xl bg-slate-900/90 border border-fuchsia-500/30 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-fuchsia-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-fuchsia-400" />
              [{projectName}] 맞춤 에이전트 추천 (원하는 역할만 골라 추가하세요)
            </h3>
            <div className="text-xs text-slate-400 mt-1 space-y-0.5">
              {(
                analysis?.summaryDescription ||
                "프로젝트의 기술 스택을 분석하여 추천하는 역할별 에이전트 후보입니다."
              )
                .split(/(?<=[.!?])\s+/)
                .filter(Boolean)
                .map((sentence, sIdx) => (
                  <p key={sIdx}>{sentence}</p>
                ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onOpenAiDeepModal && (
              <button
                onClick={onOpenAiDeepModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white text-xs font-bold shadow-lg transition active:scale-[0.98]"
                title="연결된 AI 모델(Claude, GPT, Gemini, Groq, Ollama)이 프로젝트 코드를 심층 분석하여 맞춤형 팀을 자동 기획합니다"
              >
                <Bot className="w-4 h-4" />
                <span>✨ AI 심층 팀빌딩</span>
              </button>
            )}

            {unaddedRecommendations.length > 0 && (
              <button
                onClick={() =>
                  onAddAllRecommended(
                    recommendations.flatMap((r, idx) => {
                      if (isRecAlreadyAdded(r)) return [];
                      const key = r.id ?? `rec-${idx}`;
                      return [{
                        ...r,
                        cliId: recCliOverrides[key] ?? r.cliId,
                        useWrapper: recWrapperOverrides[key] ?? r.useWrapper,
                        model: (recModelOverrides[key] ?? r.model ?? "").trim(),
                      }];
                    })
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold shadow transition"
              >
                <Wand2 className="w-3.5 h-3.5" />
                추천 에이전트 {unaddedRecommendations.length}명 전체 추가
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {recommendations.map((rec, idx) => {
            const key = rec.id ?? `rec-${idx}`;
            const alreadyInProject = isRecAlreadyAdded(rec);
            const selectedCliId = recCliOverrides[key] ?? rec.cliId;
            const selectedWrapper =
              recWrapperOverrides[key] ?? rec.useWrapper;
            const selectedModel = recModelOverrides[key] ?? rec.model ?? "";
            const cliObj = clis.find((c) => c.id === selectedCliId);

            return (
              <div
                key={key}
                className={`p-4 rounded-xl border flex flex-col justify-between gap-3 transition ${
                  alreadyInProject
                    ? "bg-slate-950/40 border-slate-800/70 opacity-75"
                    : "bg-slate-950/90 border-slate-800 hover:border-fuchsia-500/40"
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">{rec.avatarEmoji}</span>
                      <div>
                        <div className="font-bold text-sm text-slate-100">
                          {rec.name}
                        </div>
                        <div className="text-xs font-semibold text-fuchsia-300">
                          {rec.roleTitle}
                        </div>
                      </div>
                    </div>

                    {alreadyInProject && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold shrink-0">
                        <Check className="w-3 h-3" />
                        추가됨
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-slate-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-1 max-h-32 overflow-y-auto">
                    {rec.rolePrompt
                      .split(/(?<=[.!?])\s+/)
                      .filter(Boolean)
                      .map((sentence, sIdx) => (
                        <p key={sIdx} className="leading-relaxed">
                          {sentence}
                        </p>
                      ))}
                  </div>

                  {!alreadyInProject && (
                    <div className="pt-1 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400">
                          담당 CLI 지정:
                        </span>
                        <Select
                          value={selectedCliId}
                          onChange={(v) => {
                            setRecCliOverrides((prev) => ({ ...prev, [key]: v }));
                            setRecModelOverrides((prev) => ({ ...prev, [key]: "" }));
                          }}
                          options={clis.map((c) => ({ value: c.id, label: `${c.name} (${c.provider})` }))}
                          className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-medium w-[62%]"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400 shrink-0">
                          실행 모델:
                        </span>
                        <ModelPicker
                          cliId={selectedCliId}
                          value={selectedModel}
                          onChange={(m) => setRecModelOverrides((prev) => ({ ...prev, [key]: m }))}
                          className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono w-[62%]"
                        />
                      </div>

                      {cliObj?.wrapperBinary && (
                        <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer pt-0.5">
                          <input
                            type="checkbox"
                            checked={selectedWrapper}
                            onChange={(e) =>
                              setRecWrapperOverrides((prev) => ({
                                ...prev,
                                [key]: e.target.checked,
                              }))
                            }
                            className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0"
                          />
                          <span>
                            Headroom 토큰 최적화 래퍼 적용 ({cliObj.wrapperBinary})
                          </span>
                        </label>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800">
                  {alreadyInProject ? (
                    <div className="text-center text-xs text-slate-500 py-1">
                      이미 이 프로젝트에 배정된 에이전트입니다
                    </div>
                  ) : (
                    <button
                      onClick={() =>
                        onAddRecommendedAgent({
                          ...rec,
                          cliId: selectedCliId,
                          useWrapper: selectedWrapper,
                          model: selectedModel.trim(),
                        })
                      }
                      className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-bold transition shadow"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      이 역할 에이전트 팀에 추가
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* =====================================================================
          모달: 👑 총괄 PM 중심 무인 자율 협업 오케스트레이션 대화창
         ===================================================================== */}
      {showAutoRelayModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-fuchsia-500/40 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500/20 to-indigo-500/20 border border-fuchsia-500/40 flex items-center justify-center text-fuchsia-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    👑 총괄 PM 및 에이전트 상호 P2P 무인 자율 협업
                  </h3>
                  <p className="text-xs text-slate-400 break-keep">
                    총괄 PM이 지시를 내릴 뿐만 아니라, 도메인 에이전트들이 서로 직접 실시간 소통하며 작업을 자율 완수합니다.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAutoRelayModal(false)}
                className="text-slate-500 hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-fuchsia-400" />
                  프로젝트 최종 목표 / 협업 지시사항
                </label>
                <textarea
                  value={relayGoalInput}
                  onChange={(e) => setRelayGoalInput(e.target.value)}
                  placeholder="예: 실시간 협업 IPC 파이프라인과 토큰 최적화 로직을 구현하고, 백엔드와 프론트엔드가 상호 데이터 규격을 맞춘 뒤 QA 에이전트가 빌드 무결성 검증까지 완료해줘."
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-fuchsia-500 leading-relaxed resize-none transition"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    유기적 상호 P2P 릴레이 & 자율 대화 구조
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400 font-semibold">
                    ⚡ 완전 자동 실행 (승인 질문 일체 생략)
                  </span>
                </label>

                <div className="rounded-xl bg-slate-950/95 border border-slate-800/90 p-3.5 space-y-2.5 max-h-60 overflow-y-auto text-xs break-keep">
                  <div className="flex items-start gap-2 text-purple-400 bg-purple-500/10 p-2.5 rounded-lg border border-purple-500/20">
                    <span className="shrink-0 font-bold">👑 총괄 PM:</span>
                    <p className="leading-relaxed text-slate-300 text-[11px]">
                      사용자 목표를 접수하여 <code>.ai-agents/BLACKBOARD.md</code>에 아키텍처 설계를 수립하고 각 에이전트에게 하위 태스크를 분배합니다.
                    </p>
                  </div>

                  {/* 도메인 에이전트 간 직접 P2P 상호 대화 릴레이 */}
                  <div className="pl-3 py-1 space-y-2 border-l-2 border-indigo-500/40">
                    <div className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      도메인 에이전트 간 직접 상호 연동 (Peer-to-Peer Relay)
                    </div>

                    {agents.length > 0 ? (
                      agents
                        .filter(
                          (a) =>
                            !a.name.includes("PM") &&
                            !a.roleTitle.includes("PM") &&
                            !a.roleTitle.includes("리더")
                        )
                        .map((ag) => (
                          <div
                            key={ag.id}
                            className="flex items-start gap-2 text-slate-300 bg-slate-900/60 p-2 rounded-lg border border-slate-800 text-[11px]"
                          >
                            <span className="shrink-0 text-sm">{ag.avatarEmoji}</span>
                            <div className="min-w-0">
                              <span className="font-bold text-slate-200 mr-1.5">{ag.name}:</span>
                              <span className="text-slate-400">
                                담당 직무({ag.roleTitle})를 수행하며 다른 도메인 에이전트와 필요한 API 규격, 상태, 파일 변경사항을 직접 주고받습니다.
                              </span>
                            </div>
                          </div>
                        ))
                    ) : (
                      <div className="text-[11px] text-slate-400 bg-slate-900/50 p-2 rounded-lg border border-slate-800">
                        백엔드, 프론트엔드, QA 에이전트가 공유 블랙보드를 통해 서로 직접 질의응답하며 산출물을 교차 검증합니다.
                      </div>
                    )}
                  </div>

                  <div className="flex items-start gap-2 text-purple-400 bg-purple-500/10 p-2.5 rounded-lg border border-purple-500/20">
                    <span className="shrink-0 font-bold">👑 총괄 PM:</span>
                    <p className="leading-relaxed text-slate-300 text-[11px]">
                      모든 에이전트의 완료 산출물 및 테스트 결과를 종합하여 사용자에게 최종 요약 보고를 제출합니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-400 break-keep hidden sm:inline">
                💡 총괄 PM과 에이전트들이 사람 개입 없이 스스로 대화를 주고받으며 작업을 완료합니다.
              </span>
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                <button
                  type="button"
                  onClick={() => setShowAutoRelayModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition whitespace-nowrap min-w-[70px]"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={handleSubmitAutonomousRelay}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-fuchsia-600 via-indigo-600 to-emerald-600 hover:opacity-95 text-white text-xs font-bold transition shadow-lg flex items-center gap-2 whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>🚀 무인 자율 협업 가동</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
