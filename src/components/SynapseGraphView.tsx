import React, { useState } from "react";
import {
  BrainCircuit,
  FileCode,
  FileText,
  Layers,
  Play,
  Radio,
  Send,
  Terminal,
} from "lucide-react";
import type { CliDefinition, ProjectAgentRecord, SessionInfo } from "../types/types";

interface SynapseGraphViewProps {
  projectPath: string;
  projectName: string;
  agents: ProjectAgentRecord[];
  clis: CliDefinition[];
  runningSessions: SessionInfo[];
  onSpawnAgent: (agent: ProjectAgentRecord) => Promise<void>;
  onFocusSession: (sessionId: string) => void;
  onOpenBlackboard: () => void;
  onSendPromptToAgent: (agentId: string, prompt: string) => Promise<void>;
}

interface SynapseNode {
  id: string;
  name: string;
  role: string;
  emoji: string;
  color: string;
  x: number;
  y: number;
  type: "pm" | "agent" | "blackboard" | "headroom";
  connectedFiles: string[];
  agentRecord?: ProjectAgentRecord;
}

export const SynapseGraphView: React.FC<SynapseGraphViewProps> = ({
  projectPath: _projectPath,
  projectName,
  agents,
  clis: _clis,
  runningSessions,
  onSpawnAgent,
  onFocusSession,
  onOpenBlackboard,
  onSendPromptToAgent,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [quickPrompt, setQuickPrompt] = useState("");

  const centerX = 400;
  const centerY = 240;

  // 총괄 PM 탐색
  const pmAgent =
    agents.find(
      (a) =>
        a.roleTitle.toLowerCase().includes("pm") ||
        a.roleTitle.includes("리더") ||
        a.name.includes("PM")
    ) || agents[0];

  const domainAgents = agents.filter((a) => a.id !== pmAgent?.id);

  const nodes: SynapseNode[] = [];

  // 1. 중앙 허브: 총괄 PM
  if (pmAgent) {
    nodes.push({
      id: pmAgent.id,
      name: pmAgent.name,
      role: pmAgent.roleTitle,
      emoji: pmAgent.avatarEmoji || "👑",
      color: "#a855f7",
      x: centerX,
      y: centerY,
      type: "pm",
      connectedFiles: [
        ".ai-agents/BLACKBOARD.md",
        `.ai-agents/agents/${pmAgent.id}/ROLE.md`,
        "README.md",
        "아키텍처 설계 & 업무 분배",
      ],
      agentRecord: pmAgent,
    });
  }

  // 2. 도메인 에이전트 노드 배치: 중앙 수직축(Headroom/Blackboard)과 겹치지 않도록 좌우 양 날개에 대칭 배치
  const leftAgents = domainAgents.filter((_, idx) => idx % 2 === 0);
  const rightAgents = domainAgents.filter((_, idx) => idx % 2 === 1);

  const calculateY = (agentIndex: number, totalInSide: number) => {
    if (totalInSide <= 1) return centerY;
    const step = 220 / Math.max(totalInSide - 1, 1);
    return 130 + agentIndex * step;
  };

  leftAgents.forEach((agent, i) => {
    const y = calculateY(i, leftAgents.length);
    nodes.push({
      id: agent.id,
      name: agent.name,
      role: agent.roleTitle,
      emoji: agent.avatarEmoji || "🤖",
      color: agent.accentColor || "#06b6d4",
      x: 170,
      y,
      type: "agent",
      connectedFiles: getFilesForAgent(agent),
      agentRecord: agent,
    });
  });

  rightAgents.forEach((agent, i) => {
    const y = calculateY(i, rightAgents.length);
    nodes.push({
      id: agent.id,
      name: agent.name,
      role: agent.roleTitle,
      emoji: agent.avatarEmoji || "🤖",
      color: agent.accentColor || "#38bdf8",
      x: 630,
      y,
      type: "agent",
      connectedFiles: getFilesForAgent(agent),
      agentRecord: agent,
    });
  });

  // 3. 최상단: Headroom 토큰 압축 프록시
  nodes.push({
    id: "hub-headroom",
    name: "Headroom 토큰 프록시",
    role: "127.0.0.1:8788 (컨텍스트 캐시 & 압축)",
    emoji: "⚡",
    color: "#10b981",
    x: centerX,
    y: 65,
    type: "headroom",
    connectedFiles: [
      "~/.local/bin/headroom.exe",
      "실시간 토큰 사용량 & 컨텍스트 75% 압축",
    ],
  });

  // 4. 최하단: 공유 메모리 브릿지 (BLACKBOARD)
  nodes.push({
    id: "hub-blackboard",
    name: "공유 메모리 브릿지",
    role: ".ai-agents/BLACKBOARD.md",
    emoji: "📋",
    color: "#3b82f6",
    x: centerX,
    y: 415,
    type: "blackboard",
    connectedFiles: [
      ".ai-agents/BLACKBOARD.md",
      "에이전트 간 비동기 메모 & 업무 인수인계",
    ],
  });

  function getFilesForAgent(agent: ProjectAgentRecord): string[] {
    const files = [
      `.ai-agents/agents/${agent.id}/ROLE.md`,
      ".ai-agents/BLACKBOARD.md",
    ];
    const roleLower = (agent.roleTitle + agent.name).toLowerCase();
    if (roleLower.includes("rust") || roleLower.includes("백엔드") || roleLower.includes("core")) {
      files.push("src-tauri/src/pty.rs", "src-tauri/src/main.rs", "src-tauri/src/db.rs", "Cargo.toml");
    } else if (roleLower.includes("프론트") || roleLower.includes("ui") || roleLower.includes("react")) {
      files.push("src/App.tsx", "src/components/*.tsx", "src/index.css", "package.json");
    } else if (roleLower.includes("qa") || roleLower.includes("테스트") || roleLower.includes("리뷰")) {
      files.push("tests/*", "cargo test", "npm test", "무결성 검증 파이프라인");
    } else if (roleLower.includes("보안") || roleLower.includes("빌드") || roleLower.includes("배포")) {
      files.push("src-tauri/tauri.conf.json", "암호화 볼트", "릴리즈 패키징");
    } else {
      files.push("src/**/*.*", "프로젝트 전용 코드 모듈");
    }
    return files;
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[0];
  const runningSession = runningSessions.find(
    (s) => s.agentId === selectedNode?.agentRecord?.id
  );

  const handleSendPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPrompt.trim() || !selectedNode?.agentRecord) return;
    await onSendPromptToAgent(selectedNode.agentRecord.id, `${quickPrompt.trim()}\r`);
    setQuickPrompt("");
  };

  return (
    <div className="flex flex-col lg:flex-row w-full bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
      {/* =====================================================================
          좌측: 시냅스 인터랙티브 캔버스 (SVG 신경망 시각화)
         ===================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-slate-950 via-slate-900/60 to-slate-950 p-4 border-b lg:border-b-0 lg:border-r border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <BrainCircuit className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                [{projectName}] 에이전트 & 소스코드 시냅스 협업 지도
              </h3>
              <p className="text-[11px] text-slate-400">
                총괄 PM을 중심으로 각 에이전트가 어떤 파일과 역할을 담당하고 유기적으로 대화하는지 신경망 구조로 시각화합니다.
              </p>
            </div>
          </div>

          <button
            onClick={onOpenBlackboard}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium transition"
          >
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            블랙보드 메모장 열기
          </button>
        </div>

        {/* SVG 시냅스 맵 영역 */}
        <div className="relative flex-1 min-h-[480px] bg-slate-950/80 rounded-xl border border-slate-800/80 overflow-hidden flex items-center justify-center select-none">
          <div
            className="absolute inset-0 opacity-15 pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, #6366f1 1px, transparent 0)",
              backgroundSize: "28px 28px",
            }}
          />

          <svg
            viewBox="0 0 800 480"
            className="w-full h-full max-h-[500px] drop-shadow-lg"
          >
            <defs>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* 시냅스 연결선 (Connecting Paths) */}
            {pmAgent &&
              nodes
                .filter((n) => n.id !== pmAgent.id)
                .map((target) => {
                  const isSelected =
                    selectedNodeId === target.id ||
                    (selectedNodeId === pmAgent.id && target.type === "agent");

                  return (
                    <g key={`edge-${target.id}`}>
                      <line
                        x1={centerX}
                        y1={centerY}
                        x2={target.x}
                        y2={target.y}
                        stroke={isSelected ? target.color : "#334155"}
                        strokeWidth={isSelected ? 2.5 : 1.2}
                        strokeDasharray={target.type.startsWith("hub") ? "4,4" : "none"}
                        opacity={isSelected ? 0.9 : 0.4}
                        className="transition-all duration-300"
                      />

                      <circle r={isSelected ? 3.5 : 2.5} fill={target.color}>
                        <animateMotion
                          path={`M ${centerX} ${centerY} L ${target.x} ${target.y}`}
                          dur={isSelected ? "2s" : "3.5s"}
                          repeatCount="indefinite"
                        />
                      </circle>
                    </g>
                  );
                })}

            {/* 도메인 에이전트 간 유기적 P2P 직통 상호 연결망 (Mesh Topology) */}
            {domainAgents.map((ag, idx) => {
              const nextAg = domainAgents[(idx + 1) % domainAgents.length];
              if (!nextAg || domainAgents.length < 2) return null;
              const n1 = nodes.find((n) => n.id === ag.id);
              const n2 = nodes.find((n) => n.id === nextAg.id);
              if (!n1 || !n2) return null;

              const isPeerActive =
                selectedNodeId === n1.id || selectedNodeId === n2.id;

              return (
                <g key={`peer-edge-${n1.id}-${n2.id}`}>
                  <line
                    x1={n1.x}
                    y1={n1.y}
                    x2={n2.x}
                    y2={n2.y}
                    stroke={isPeerActive ? "#38bdf8" : "#6366f1"}
                    strokeWidth={isPeerActive ? 2 : 1.2}
                    strokeDasharray="4,4"
                    opacity={isPeerActive ? 0.9 : 0.55}
                    className="transition-all duration-200"
                  />
                  <circle r={2} fill={isPeerActive ? "#38bdf8" : "#a855f7"}>
                    <animateMotion
                      path={`M ${n1.x} ${n1.y} L ${n2.x} ${n2.y}`}
                      dur="4s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </g>
              );
            })}

            {/* 시냅스 노드 렌더링 */}
            {nodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const isRunning = runningSessions.some(
                (s) => s.agentId === node.agentRecord?.id
              );

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => setSelectedNodeId(node.id)}
                  className="cursor-pointer group"
                >
                  <circle
                    r={node.type === "pm" ? 36 : 28}
                    fill={node.color}
                    fillOpacity={isSelected ? 0.35 : 0.12}
                    stroke={node.color}
                    strokeWidth={isSelected ? 3 : 1.5}
                    filter={isSelected ? "url(#glow)" : undefined}
                    className="transition-all duration-150 group-hover:stroke-white group-hover:stroke-[2.5px] group-hover:fill-opacity-30"
                  />

                  <circle
                    r={node.type === "pm" ? 28 : 22}
                    style={{ fill: "rgb(var(--slate-900))" }}
                    stroke={isSelected ? node.color : "#475569"}
                    strokeWidth={isSelected ? 2 : 1}
                    className="transition-colors duration-150 group-hover:stroke-slate-300"
                  />

                  <text
                    textAnchor="middle"
                    dy="7"
                    fontSize={node.type === "pm" ? 20 : 16}
                    className="select-none pointer-events-none"
                  >
                    {node.emoji}
                  </text>

                  {isRunning && (
                    <circle
                      cx="18"
                      cy="-18"
                      r="5"
                      fill="#10b981"
                      style={{ stroke: "rgb(var(--slate-900))" }}
                      strokeWidth="1.5"
                    />
                  )}

                  <text
                    y={node.type === "pm" ? 48 : 38}
                    textAnchor="middle"
                    style={{ fill: isSelected ? "rgb(var(--slate-50))" : "rgb(var(--slate-400))" }}
                    fontSize="11"
                    fontWeight={isSelected ? "bold" : "600"}
                    className="pointer-events-none"
                  >
                    {node.name}
                  </text>
                  <text
                    y={node.type === "pm" ? 61 : 51}
                    textAnchor="middle"
                    style={{ fill: "rgb(var(--slate-500))" }}
                    fontSize="9"
                    className="pointer-events-none"
                  >
                    {node.role.slice(0, 18)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* 하단 범례 안내 바 (정상 flex 레이아웃으로 겹침 방지) */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 bg-slate-950/90 px-3.5 py-2 rounded-xl border border-slate-800">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
              👑 총괄 PM (오케스트레이션 허브)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
              도메인 에이전트
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              공유 블랙보드
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              Headroom 토큰 압축
            </span>
            <span className="flex items-center gap-1.5 text-indigo-300 font-semibold">
              <span className="w-3.5 h-0.5 border-t border-dashed border-indigo-400" />
              ⇄ 에이전트 간 직접 P2P 릴레이
            </span>
          </div>
          <span className="text-indigo-300 font-mono">
            노드를 클릭하면 담당 파일 및 터미널 상태를 확인합니다
          </span>
        </div>
      </div>

      {/* =====================================================================
          우측: 선택된 시냅스 노드 상세 정보 & 파일 연결 리스트
         ===================================================================== */}
      <div className="w-full lg:w-96 p-5 flex flex-col justify-between space-y-4 bg-slate-900/90 overflow-y-auto">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-3xl shrink-0 p-2 rounded-xl bg-slate-950 border border-slate-800">
                {selectedNode.emoji}
              </span>
              <div className="min-w-0">
                <h4 className="font-bold text-sm text-slate-100 truncate">
                  {selectedNode.name}
                </h4>
                <p className="text-xs text-indigo-300 truncate font-semibold">
                  {selectedNode.role}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      runningSession
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-slate-800 text-slate-400 border border-slate-700"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        runningSession ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                      }`}
                    />
                    {runningSession ? "터미널 세션 실행 중" : "대기 상태"}
                  </span>
                  {selectedNode.agentRecord?.useWrapper && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold border border-emerald-500/30">
                      ⚡ Headroom
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {selectedNode.agentRecord && (
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Radio className="w-3 h-3 text-fuchsia-400" />
                에이전트 역할 지침
              </label>
              <div className="text-xs text-slate-300 bg-slate-950/90 p-3 rounded-lg border border-slate-800 space-y-1 max-h-28 overflow-y-auto leading-relaxed">
                {selectedNode.agentRecord.rolePrompt
                  .split(/(?<=[.!?])\s+/)
                  .filter(Boolean)
                  .map((s, idx) => (
                    <p key={idx}>{s}</p>
                  ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              시냅스로 연결된 담당 소스코드 & 리소스 ({selectedNode.connectedFiles.length})
            </label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {selectedNode.connectedFiles.map((file, fIdx) => (
                <div
                  key={fIdx}
                  className="flex items-center justify-between p-2 rounded-lg bg-slate-950/70 border border-slate-800/90 hover:border-slate-700 text-xs text-slate-300 font-mono transition"
                >
                  <span className="flex items-center gap-2 truncate">
                    <FileCode className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="truncate">{file}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0 uppercase px-1.5 py-0.5 rounded bg-slate-900">
                    연결됨
                  </span>
                </div>
              ))}
            </div>
          </div>

          {selectedNode.agentRecord && runningSession && (
            <form onSubmit={handleSendPrompt} className="pt-2 border-t border-slate-800 space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Send className="w-3.5 h-3.5 text-cyan-400" />
                이 에이전트에게 실시간 지시 전달
              </label>
              <div className="flex gap-1.5">
                <input
                  value={quickPrompt}
                  onChange={(e) => setQuickPrompt(e.target.value)}
                  placeholder={`${selectedNode.name}에게 전달할 명령 입력...`}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shrink-0"
                >
                  전송
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="pt-3 border-t border-slate-800 space-y-2">
          {selectedNode.agentRecord ? (
            runningSession ? (
              <button
                onClick={() => onFocusSession(runningSession.id)}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow flex items-center justify-center gap-1.5"
              >
                <Terminal className="w-4 h-4" />
                터미널 화면으로 이동 →
              </button>
            ) : (
              <button
                onClick={() => onSpawnAgent(selectedNode.agentRecord!)}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow flex items-center justify-center gap-1.5"
              >
                <Play className="w-4 h-4" />
                {selectedNode.name} 에이전트 실행
              </button>
            )
          ) : (
            <button
              onClick={onOpenBlackboard}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition border border-slate-700 flex items-center justify-center gap-1.5"
            >
              <FileText className="w-4 h-4 text-cyan-400" />
              공유 블랙보드 메모장 열기
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
