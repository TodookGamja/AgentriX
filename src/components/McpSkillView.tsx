import React, { useMemo, useState } from "react";
import {
  ArchiveRestore,
  Blocks,
  Check,
  CheckCircle2,
  Copy,
  FileCode2,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { BackupRecord, CliDefinition, RegistryItem } from "../types/types";

interface McpSkillViewProps {
  items: RegistryItem[];
  backups: BackupRecord[];
  clis: CliDefinition[];
  onToggleItem: (itemId: string, enabled: boolean) => Promise<void>;
  onApplyToCli: (itemId: string, cliId: string) => Promise<void>;
  onScanLocalExtensions: () => Promise<void>;
  onCreateItem: (payload: {
    id: string;
    kind: string;
    name: string;
    description: string;
    configJson: string;
    appliedClis: string[];
  }) => Promise<void>;
}

const ConfigCodeBlock: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const formatted = useMemo(() => {
    try {
      const parsed = JSON.parse(code);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return code;
    }
  }, [code]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(formatted).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="mt-2.5 rounded-xl border border-slate-800/80 bg-slate-950/60 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-900/50 hover:bg-slate-900/80 text-[11px] text-slate-400 transition select-none"
      >
        <span className="font-mono text-[10px] text-slate-300 font-semibold flex items-center gap-1.5">
          <span>설정 JSON 스키마</span>
          <span className="text-slate-500 text-[10px]">{isOpen ? "(접기)" : "(보기)"}</span>
        </span>
        <div className="flex items-center gap-2">
          <span
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-slate-800 text-slate-300 hover:text-slate-100 transition text-[10px] font-medium"
            title="설정 내용 클립보드에 복사"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400 font-semibold">복사 완료</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-slate-400" />
                <span>복사</span>
              </>
            )}
          </span>
        </div>
      </button>
      {isOpen && (
        <pre className="p-3 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap break-all leading-relaxed select-text border-t border-slate-800/60 bg-slate-950/90">
          {formatted}
        </pre>
      )}
    </div>
  );
};

export const McpSkillView: React.FC<McpSkillViewProps> = ({
  items,
  backups,
  clis,
  onToggleItem,
  onApplyToCli,
  onScanLocalExtensions,
  onCreateItem,
}) => {
  const [filterKind, setFilterKind] = useState<"all" | "mcp" | "skill" | "plugin">("all");
  const [scanning, setScanning] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKind, setNewKind] = useState<"mcp" | "skill" | "plugin">("mcp");
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCommand, setNewCommand] = useState("npx");
  const [newArgs, setNewArgs] = useState("-y @modelcontextprotocol/server-filesystem .");
  const [newSkillMd, setNewSkillMd] = useState(
    "---\nname: custom-skill\ndescription: Custom workflow skill\n---\n\n# Custom Skill\nFollow project conventions.\n"
  );

  const tokenSavers = items.filter((i) => i.isTokenSaver);
  const filteredItems = items.filter((i) =>
    filterKind === "all" ? true : i.kind === filterKind
  );

  const mcpCount = items.filter((i) => i.kind === "mcp").length;
  const skillCount = items.filter((i) => i.kind === "skill").length;
  const pluginCount = items.filter((i) => i.kind === "plugin").length;

  const handleScan = async () => {
    setScanning(true);
    try {
      await onScanLocalExtensions();
    } finally {
      setScanning(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim() || !newName.trim()) return;
    const configJson =
      newKind === "mcp"
        ? JSON.stringify(
            {
              command: newCommand.trim(),
              args: newArgs
                .split(" ")
                .map((s) => s.trim())
                .filter(Boolean),
              env: {},
            },
            null,
            2
          )
        : JSON.stringify(
            {
              skillFolder: newId.trim(),
              skillMarkdown: newSkillMd,
            },
            null,
            2
          );

    await onCreateItem({
      id: newId.trim(),
      kind: newKind,
      name: newName.trim(),
      description: newDesc.trim() || "사용자 정의 확장 항목",
      configJson,
      appliedClis: [],
    });

    setNewId("");
    setNewName("");
    setNewDesc("");
    setShowAddModal(false);
  };

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 space-y-6 pb-24 bg-slate-950">
      {/* 상단 제목 및 로컬 스캔 / 추가 버튼 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Blocks className="w-5 h-5 text-indigo-400" />
            플러그인 · 스킬 · MCP 중앙 레지스트리 & 로컬 환경 자동 연동
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            현재 PC의 `~/.claude.json`, `~/.codex/config.toml`, `~/.grok/config.toml`, 각 CLI의 `skills/` 및 `plugins/`를 자동 감지했으며, 다른 CLI에도 원클릭으로 복제·배포할 수 있습니다 (수정 전 `.bak` 백업 필수 생성).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? "animate-spin" : ""}`} />
            로컬 설치 환경 다시 스캔
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition"
          >
            <Plus className="w-4 h-4" />
            새 MCP / 스킬 / 플러그인 추가
          </button>
        </div>
      </div>

      {/* 핵심 토큰 관리 도구 (Headroom MCP & Caveman Skill 기본 적용 영역) */}
      <div className="rounded-2xl bg-slate-900/40 border border-slate-800/80 p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                기본 적용 토큰 절감 도구
                <span className="text-xs font-normal text-slate-400">
                  (Headroom MCP & Caveman Skill)
                </span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                불필요한 프롬프트 중복과 장황한 출력을 억제하여 토큰 소비량과 응답 지연을 대폭 절약합니다.
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-slate-800/90 text-slate-300 border border-slate-700/80 text-[11px] font-medium">
            기본 활성화 · 언제든 개별 설정 가능
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tokenSavers.map((saver) => (
            <div
              key={saver.id}
              className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/80 flex flex-col justify-between gap-3.5 hover:border-slate-700/80 transition-colors"
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 uppercase text-[10px] font-bold tracking-wide">
                      {saver.kind}
                    </span>
                    <span className="font-bold text-sm text-slate-100">
                      {saver.name}
                    </span>
                  </div>

                  <button
                    onClick={() => onToggleItem(saver.id, !saver.enabled)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition shrink-0 border ${
                      saver.enabled
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25"
                        : "bg-slate-800/80 text-slate-400 border-slate-700/80 hover:bg-slate-800"
                    }`}
                  >
                    {saver.enabled ? "● 켜짐 (ON)" : "○ 꺼짐 (OFF)"}
                  </button>
                </div>

                <div className="text-xs text-slate-400 space-y-1">
                  {saver.description
                    .split(/(?<=[.!?])\s+/)
                    .filter(Boolean)
                    .map((sentence, sIdx) => (
                      <p key={sIdx} className="leading-relaxed">
                        {sentence}
                      </p>
                    ))}
                </div>

                <ConfigCodeBlock code={saver.configJson} />
              </div>

              <div className="pt-2.5 border-t border-slate-800/60 flex flex-col gap-2">
                <span className="text-[11px] font-medium text-slate-400">
                  대상 CLI 설정 파일에 즉시 동기화:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {clis.map((cli) => {
                    const isApplied = saver.appliedClis.includes(cli.id);
                    return (
                      <button
                        key={cli.id}
                        onClick={() => onApplyToCli(saver.id, cli.id)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition ${
                          isApplied
                            ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-600 hover:text-white"
                            : "bg-slate-900/60 hover:bg-slate-800 text-slate-300 hover:text-slate-100 border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        {isApplied ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Send className="w-3 h-3 text-slate-400" />
                        )}
                        <span>{cli.name} {isApplied ? "해제" : "적용"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 전체 레지스트리 필터 및 리스트 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
            {(["all", "mcp", "skill", "plugin"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilterKind(k)}
                className={`px-3 py-1 rounded text-xs font-medium transition ${
                  filterKind === k
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {k === "all"
                  ? `전체 (${items.length})`
                  : k === "mcp"
                  ? `MCP 서버 (${mcpCount})`
                  : k === "skill"
                  ? `스킬 (${skillCount})`
                  : `플러그인 (${pluginCount})`}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">
            현재 필터 표시: {filteredItems.length}개 항목
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-indigo-300 uppercase text-[10px] font-bold border border-slate-700 shrink-0">
                      {item.kind}
                    </span>
                    <h4 className="font-semibold text-sm text-slate-100 truncate">
                      {item.name}
                    </h4>
                  </div>
                  <button
                    onClick={() => onToggleItem(item.id, !item.enabled)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition shrink-0 ${
                      item.enabled
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        : "bg-slate-800 text-slate-400 border border-slate-700"
                    }`}
                  >
                    {item.enabled ? "활성화됨" : "비활성화됨"}
                  </button>
                </div>

                <div className="text-xs text-slate-400 mt-2 space-y-1">
                  {item.description
                    .split(/(?<=[.!?])\s+/)
                    .filter(Boolean)
                    .map((sentence, sIdx) => (
                      <p key={sIdx} className="leading-relaxed">
                        {sentence}
                      </p>
                    ))}
                </div>

                <ConfigCodeBlock code={item.configJson} />
              </div>

              <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Wrench className="w-3.5 h-3.5 text-slate-500" />
                  <span>CLI별 적용/해제:</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {clis.map((cli) => {
                    const isApplied = item.appliedClis.includes(cli.id);
                    return (
                      <button
                        key={cli.id}
                        onClick={() => onApplyToCli(item.id, cli.id)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition ${
                          isApplied
                            ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-600 hover:text-white"
                            : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                        }`}
                      >
                        {isApplied && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        {cli.name} {isApplied ? "해제" : "적용"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 설정 파일 백업(.bak + 타임스탬프) 감사 로그 */}
      <div className="rounded-xl bg-slate-900/90 border border-slate-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArchiveRestore className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              외부 CLI 설정 파일 자동 백업 히스토리 (`.bak` + 타임스탬프)
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            수정 전 자동 백업 원칙 준수 ({backups.length}건 기록됨)
          </span>
        </div>

        {backups.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 flex flex-col items-center gap-1.5">
            <ShieldAlert className="w-5 h-5 text-slate-600" />
            <span>
              위 항목에서 CLI 버튼을 누르면 기존 설정 파일이 `.bak.YYYYMMDD_HHMMSS` 형식으로 안전하게 백업된 후 적용됩니다.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                  <th className="py-2.5 px-4">시각</th>
                  <th className="py-2.5 px-4">대상 CLI</th>
                  <th className="py-2.5 px-4">원본 파일 경로</th>
                  <th className="py-2.5 px-4">생성된 백업 파일 (.bak)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {backups.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono text-slate-400">
                      {b.createdAt.slice(0, 19).replace("T", " ")}
                    </td>
                    <td className="py-2.5 px-4 uppercase font-semibold text-indigo-300">
                      {b.cliId}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-300">
                      {b.originalPath}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-emerald-400">
                      {b.backupPath}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 새 항목 추가 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-lg rounded-xl bg-slate-900 border border-slate-700 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-indigo-400" />
                새 플러그인 / 스킬 / MCP 서버 등록
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-100 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(["mcp", "skill", "plugin"] as const).map((k) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setNewKind(k)}
                  className={`py-2 rounded-lg text-xs font-semibold border uppercase transition ${
                    newKind === k
                      ? "bg-indigo-600 text-white border-indigo-500"
                      : "bg-slate-800 text-slate-300 border-slate-700"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">식별자 (ID)</label>
                <input
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  placeholder="예: github-mcp"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">표시 이름</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="예: GitHub MCP Server"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">설명</label>
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="기능 및 목적 설명"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100"
              />
            </div>

            {newKind === "mcp" ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">실행 명령어 (command)</label>
                  <input
                    value={newCommand}
                    onChange={(e) => setNewCommand(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">인자 (공백 구분 args)</label>
                  <input
                    value={newArgs}
                    onChange={(e) => setNewArgs(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-slate-400 mb-1">SKILL.md 마크다운 본문</label>
                <textarea
                  rows={5}
                  value={newSkillMd}
                  onChange={(e) => setNewSkillMd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium"
              >
                취소
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                레지스트리에 등록
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
