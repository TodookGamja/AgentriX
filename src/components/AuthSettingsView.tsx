import React, { useState } from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  Download,
  FolderCog,
  KeyRound,
  Lock,
  LogIn,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import type { ApiKeyStatus, CliDefinition, CustomCliInput } from "../types/types";

interface AuthSettingsViewProps {
  clis: CliDefinition[];
  apiKeys: ApiKeyStatus[];
  onSaveKey: (cliId: string, keyName: string, rawKey: string) => Promise<void>;
  onDeleteKey: (cliId: string, keyName: string) => Promise<void>;
  onStartLoginSession: (cliId: string, loginCmd: string) => Promise<void>;
  onAddCustomCli: (input: CustomCliInput) => Promise<void>;
  onDeleteCustomCli: (cliId: string) => Promise<void>;
  onResetAppData?: () => Promise<void>;
  onCheckUpdate?: () => void;
}

interface CliPreset {
  id: string;
  name: string;
  provider: string;
  binaryCmd: string;
  installCmd: string;
  loginCmd: string;
  envKeys: string;
  configPath: string;
  logPath: string;
  color: string;
  description: string;
}

const POPULAR_CLI_PRESETS: CliPreset[] = [
  {
    id: "codex",
    name: "OpenAI Codex CLI",
    provider: "OpenAI",
    binaryCmd: "codex",
    installCmd: "npm install -g @openai/codex",
    loginCmd: "codex login",
    envKeys: "OPENAI_API_KEY",
    configPath: "~/.codex/config.json",
    logPath: "~/.codex",
    color: "#10b981",
    description: "OpenAI 공식 차세대 코드 자동화 에이전트 CLI",
  },
  {
    id: "claude",
    name: "Claude Code",
    provider: "Anthropic",
    binaryCmd: "claude",
    installCmd: "npm install -g @anthropic-ai/claude-code",
    loginCmd: "claude login",
    envKeys: "ANTHROPIC_API_KEY",
    configPath: "~/.claude.json",
    logPath: "~/.claude/logs",
    color: "#f59e0b",
    description: "Anthropic Claude의 강력한 터미널 기반 에이전틱 코딩 도구",
  },
  {
    id: "antigravity",
    name: "Antigravity (AGY)",
    provider: "Google DeepMind",
    binaryCmd: "agy",
    installCmd: "npm install -g @google/antigravity",
    loginCmd: "agy auth login",
    envKeys: "GEMINI_API_KEY",
    configPath: "~/.antigravity",
    logPath: "~/.antigravity/logs",
    color: "#6366f1",
    description: "Google DeepMind 엔지니어링 에이전트 CLI 시스템",
  },
  {
    id: "cursor",
    name: "Cursor Agent CLI",
    provider: "Anysphere",
    binaryCmd: "cursor",
    installCmd: "winget install Anysphere.Cursor",
    loginCmd: "cursor --login",
    envKeys: "CURSOR_API_KEY",
    configPath: "~/.cursor",
    logPath: "~/.cursor/logs",
    color: "#06b6d4",
    description: "Cursor AI 공식 백그라운드 터미널 에이전트",
  },
  {
    id: "grok",
    name: "Grok CLI",
    provider: "xAI",
    binaryCmd: "grok",
    installCmd: "npm install -g @xai/grok-cli",
    loginCmd: "grok auth login",
    envKeys: "XAI_API_KEY",
    configPath: "~/.grok",
    logPath: "~/.grok/logs",
    color: "#ec4899",
    description: "xAI의 초고속 추론 및 코딩 보조 터미널 CLI",
  },
  {
    id: "aider",
    name: "Aider AI",
    provider: "OpenSource",
    binaryCmd: "aider",
    installCmd: "pip install -U aider-chat",
    loginCmd: "aider",
    envKeys: "OPENAI_API_KEY, ANTHROPIC_API_KEY",
    configPath: "~/.aider.conf.yml",
    logPath: "~/.aider",
    color: "#10b981",
    description: "터미널 기반 최고 성능의 오픈소스 AI 페어 프로그래밍 CLI",
  },
  {
    id: "goose",
    name: "Goose CLI",
    provider: "Block (Square)",
    binaryCmd: "goose",
    installCmd: "pip install goose-ai",
    loginCmd: "goose configure",
    envKeys: "OPENAI_API_KEY, ANTHROPIC_API_KEY",
    configPath: "~/.config/goose/config.yaml",
    logPath: "~/.config/goose",
    color: "#f59e0b",
    description: "오픈소스 자율형 코딩 에이전트 CLI",
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    provider: "GitHub",
    binaryCmd: "gh copilot",
    installCmd: "gh extension install github/gh-copilot",
    loginCmd: "gh auth login",
    envKeys: "GITHUB_TOKEN",
    configPath: "~/.config/gh/hosts.yml",
    logPath: "~/.config/gh",
    color: "#6366f1",
    description: "GitHub 공식 Copilot 터미널 확장 도구",
  },
  {
    id: "ollama",
    name: "Ollama (Local LLM)",
    provider: "Ollama",
    binaryCmd: "ollama",
    installCmd: "winget install Ollama.Ollama",
    loginCmd: "ollama list",
    envKeys: "OLLAMA_HOST",
    configPath: "~/.ollama",
    logPath: "~/.ollama/logs",
    color: "#ec4899",
    description: "완전 로컬 오프라인 LLM 실행 엔진",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    provider: "Google",
    binaryCmd: "gemini",
    installCmd: "npm install -g @google/gemini-cli",
    loginCmd: "gemini auth",
    envKeys: "GEMINI_API_KEY, GOOGLE_API_KEY",
    configPath: "~/.gemini/config",
    logPath: "~/.gemini",
    color: "#3b82f6",
    description: "Google Gemini 공식 개발자 CLI 도구",
  },
];

export const AuthSettingsView: React.FC<AuthSettingsViewProps> = ({
  clis,
  apiKeys,
  onSaveKey,
  onDeleteKey,
  onStartLoginSession,
  onAddCustomCli,
  onDeleteCustomCli,
  onResetAppData,
  onCheckUpdate,
}) => {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [showAddCliModal, setShowAddCliModal] = useState(false);
  const [modalTab, setModalTab] = useState<"preset" | "manual">("preset");

  // 프리셋 선택 상태
  const [selectedPresetId, setSelectedPresetId] = useState<string>("aider");
  const [installCmd, setInstallCmd] = useState<string>(
    POPULAR_CLI_PRESETS[0].installCmd
  );

  // 수동/공통 폼 상태
  const [cliId, setCliId] = useState(POPULAR_CLI_PRESETS[0].id);
  const [cliName, setCliName] = useState(POPULAR_CLI_PRESETS[0].name);
  const [cliProvider, setCliProvider] = useState(POPULAR_CLI_PRESETS[0].provider);
  const [cliCommand, setCliCommand] = useState(POPULAR_CLI_PRESETS[0].binaryCmd);
  const [cliWrapper, setCliWrapper] = useState("");
  const [cliLoginCmd, setCliLoginCmd] = useState(POPULAR_CLI_PRESETS[0].loginCmd);
  const [cliEnvKeys, setCliEnvKeys] = useState(POPULAR_CLI_PRESETS[0].envKeys);
  const [cliConfigPath, setCliConfigPath] = useState(
    POPULAR_CLI_PRESETS[0].configPath
  );
  const [cliLogPath, setCliLogPath] = useState(POPULAR_CLI_PRESETS[0].logPath);
  const [cliColor, setCliColor] = useState(POPULAR_CLI_PRESETS[0].color);

  const [filterUninstalledOnly, setFilterUninstalledOnly] = useState(true);

  const isCliInstalled = (presetId: string) => {
    return clis.some(
      (c) =>
        c.installed &&
        (c.id.toLowerCase() === presetId.toLowerCase() ||
          c.name.toLowerCase().includes(presetId.toLowerCase()))
    );
  };

  const displayedPresets = POPULAR_CLI_PRESETS.filter((p) => {
    if (!filterUninstalledOnly) return true;
    return !isCliInstalled(p.id);
  });

  const applyPreset = (preset: CliPreset) => {
    setSelectedPresetId(preset.id);
    setInstallCmd(preset.installCmd);
    setCliId(preset.id);
    setCliName(preset.name);
    setCliProvider(preset.provider);
    setCliCommand(preset.binaryCmd);
    setCliLoginCmd(preset.loginCmd);
    setCliEnvKeys(preset.envKeys);
    setCliConfigPath(preset.configPath);
    setCliLogPath(preset.logPath);
    setCliColor(preset.color);
  };

  const handleSave = async (id: string, keyName: string) => {
    const mapKey = `${id}:${keyName}`;
    const val = (inputs[mapKey] ?? "").trim();
    if (!val) return;
    await onSaveKey(id, keyName, val);
    setInputs((prev) => ({ ...prev, [mapKey]: "" }));
  };

  // 1) 등록만 진행
  const handleCreateOnly = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!cliName.trim() || !cliCommand.trim()) return;
    const generatedId =
      cliId.trim() ||
      cliName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    await onAddCustomCli({
      id: generatedId,
      name: cliName.trim(),
      provider: cliProvider.trim() || "Custom",
      binaryCmd: cliCommand.trim(),
      args: cliWrapper.trim() ? [cliWrapper.trim()] : [],
      envKeys: cliEnvKeys
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      loginCommand: cliLoginCmd.trim() || `${cliCommand.trim()} --help`,
      configPath: cliConfigPath.trim(),
      skillsDir: "",
      logPath: cliLogPath.trim(),
      accentColor: cliColor || "#06b6d4",
    });
    setShowAddCliModal(false);
  };

  // 2) CLI 설치 후 로그인으로 바로 가져오기 (터미널 자동 실행)
  const handleInstallAndImport = async () => {
    if (!cliName.trim() || !cliCommand.trim()) return;
    const generatedId =
      cliId.trim() ||
      cliName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    await onAddCustomCli({
      id: generatedId,
      name: cliName.trim(),
      provider: cliProvider.trim() || "Custom",
      binaryCmd: cliCommand.trim(),
      args: cliWrapper.trim() ? [cliWrapper.trim()] : [],
      envKeys: cliEnvKeys
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      loginCommand: cliLoginCmd.trim() || `${cliCommand.trim()} --help`,
      configPath: cliConfigPath.trim(),
      skillsDir: "",
      logPath: cliLogPath.trim(),
      accentColor: cliColor || "#06b6d4",
    });

    setShowAddCliModal(false);

    // 터미널에서 설치 명령 후 로그인 명령을 체이닝 실행
    const finalLogin = cliLoginCmd.trim() || cliCommand.trim();
    const compoundCmd = installCmd.trim()
      ? `${installCmd.trim()} ; ${finalLogin}`
      : finalLogin;
    await onStartLoginSession(generatedId, compoundCmd);
  };

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 space-y-6 pb-24 bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-indigo-400" />
            CLI 환경 관리 & 인증 매니저 (구독 로그인 · 커스텀 CLI 추가 · API 키 볼트)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            현재 PC에 설치된 CLI(`claude`, `codex`, `grok`, `cursor`, `agy`, `opencode`) 및 Headroom 래퍼를 자동 감지하며, 원하는 CLI를 직접 추가하거나 설치 후 로그인으로 가져올 수 있습니다.
          </p>
        </div>

        <button
          onClick={() => setShowAddCliModal((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow"
        >
          <Plus className="w-4 h-4" />
          새 CLI 도구 추가 / 설치 가져오기
        </button>
      </div>

      {/* 새 CLI 도구 등록 모달 */}
      {showAddCliModal && (
        <div className="p-5 rounded-xl bg-slate-900 border border-indigo-500/40 space-y-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-indigo-400" />
              <h4 className="text-sm font-bold text-indigo-200">
                새 AI 코딩 CLI 추가 등록 및 설치 후 로그인 연동
              </h4>
            </div>
            <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs font-medium">
              <button
                type="button"
                onClick={() => setModalTab("preset")}
                className={`px-3 py-1 rounded-md transition ${
                  modalTab === "preset"
                    ? "bg-indigo-600 text-white font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                ⚡ 추천 CLI 설치 후 로그인으로 가져오기
              </button>
              <button
                type="button"
                onClick={() => setModalTab("manual")}
                className={`px-3 py-1 rounded-md transition ${
                  modalTab === "manual"
                    ? "bg-indigo-600 text-white font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                ✏️ 수동 직접 등록
              </button>
            </div>
          </div>

          {modalTab === "preset" ? (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-slate-300">
                <span>
                  가져올 AI 코딩 CLI를 선택하세요. 터미널이 열리며 <b>설치 명령어</b>를 수행한 뒤 자동으로 <b>로그인 세션</b>으로 이어집니다:
                </span>
                <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 cursor-pointer hover:border-indigo-500 shrink-0">
                  <input
                    type="checkbox"
                    checked={filterUninstalledOnly}
                    onChange={(e) => setFilterUninstalledOnly(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>내 PC 미설치 도구만 추천</span>
                </label>
              </div>

              {/* 프리셋 카드 그리드 */}
              {displayedPresets.length === 0 ? (
                <div className="p-8 text-center bg-slate-950/70 border border-slate-800 rounded-xl space-y-1">
                  <div className="text-sm font-bold text-emerald-400">🎉 모든 인기 AI CLI가 로컬 PC에 설치되어 있습니다!</div>
                  <div className="text-xs text-slate-400">
                    상단의 <b>[수동 직접 등록]</b> 탭을 통해 사내 비공개 CLI나 기타 도구를 추가하실 수 있습니다.
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {displayedPresets.map((p) => {
                    const isSelected = selectedPresetId === p.id;
                    const installed = isCliInstalled(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => applyPreset(p)}
                        className={`p-3 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                          isSelected
                            ? "bg-indigo-500/15 border-indigo-500 ring-1 ring-indigo-500"
                            : "bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-950"
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-slate-100 flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: p.color }}
                              />
                              {p.name}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                              installed
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                            }`}>
                              {installed ? "설치됨" : p.provider}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                            {p.description}
                          </p>
                        </div>
                        <div className="mt-2 text-[10px] font-mono text-cyan-400/90 truncate bg-slate-900 px-2 py-0.5 rounded">
                          {p.installCmd}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 선택된 프리셋 명령어 세부 조정 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-slate-950/90 p-3 rounded-lg border border-slate-800">
                <div>
                  <label className="block text-slate-400 mb-1">
                    패키지 설치 명령어 (PowerShell에서 자동 실행)
                  </label>
                  <input
                    value={installCmd}
                    onChange={(e) => setInstallCmd(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs"
                    placeholder="예: pip install -U aider-chat"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    설치 완료 후 실행할 로그인 / 시작 명령어
                  </label>
                  <input
                    value={cliLoginCmd}
                    onChange={(e) => setCliLoginCmd(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs"
                    placeholder="예: aider"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCliModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 transition"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateOnly()}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
                  title="설치 명령 실행 없이 목록에 바로 등록만 진행합니다"
                >
                  설치 없이 등록만
                </button>
                <button
                  type="button"
                  onClick={handleInstallAndImport}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-md"
                >
                  <Download className="w-3.5 h-3.5" />
                  CLI 설치 후 로그인으로 가져오기
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateOnly} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">표시 이름 *</label>
                  <input
                    value={cliName}
                    onChange={(e) => setCliName(e.target.value)}
                    placeholder="예: Aider CLI / Goose CLI"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">실행 명령어 또는 전체 경로 *</label>
                  <input
                    value={cliCommand}
                    onChange={(e) => setCliCommand(e.target.value)}
                    placeholder="예: aider 또는 C:\Users\...\bin\mycli.exe"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">공급사 / 분류</label>
                  <input
                    value={cliProvider}
                    onChange={(e) => setCliProvider(e.target.value)}
                    placeholder="예: OpenSource / Custom"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Headroom 래퍼 명령어 (선택)</label>
                  <input
                    value={cliWrapper}
                    onChange={(e) => setCliWrapper(e.target.value)}
                    placeholder="예: haider.cmd (없으면 비워두세요)"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">로그인 명령어 (선택)</label>
                  <input
                    value={cliLoginCmd}
                    onChange={(e) => setCliLoginCmd(e.target.value)}
                    placeholder="예: aider --login"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">주입할 API 키 환경변수명 (쉼표 구분)</label>
                  <input
                    value={cliEnvKeys}
                    onChange={(e) => setCliEnvKeys(e.target.value)}
                    placeholder="예: OPENAI_API_KEY, ANTHROPIC_API_KEY"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">설정 파일 경로 (선택)</label>
                  <input
                    value={cliConfigPath}
                    onChange={(e) => setCliConfigPath(e.target.value)}
                    placeholder="예: ~/.aider.conf.yml"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">로그 디렉터리 경로 (선택)</label>
                  <input
                    value={cliLogPath}
                    onChange={(e) => setCliLogPath(e.target.value)}
                    placeholder="예: ~/.aider/logs"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">배지 강조 색상</label>
                  <input
                    type="color"
                    value={cliColor}
                    onChange={(e) => setCliColor(e.target.value)}
                    className="w-full h-9 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddCliModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                >
                  도구 등록 완료
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* 1. 감지된 CLI 환경 목록 및 구독 로그인 (총 N개 CLI) */}
      <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            1. 감지된 CLI 환경 목록 및 구독 로그인 (총 {clis.length}개 CLI)
          </h3>
          <span className="text-xs text-slate-400">
            Windows PATH · `%LOCALAPPDATA%` · `~/.local/bin` · `~/.grok/bin` 자동 스캔
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clis.map((cli) => (
            <div
              key={cli.id}
              className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col justify-between min-h-[220px]"
            >
              {/* 상단: CLI 헤더 및 경로 정보 */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cli.accentColor }}
                    />
                    <span className="font-bold text-sm text-slate-100">
                      {cli.name}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      ({cli.provider})
                    </span>
                    {cli.isCustom && (
                      <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-semibold">
                        사용자 추가
                      </span>
                    )}
                  </div>
                  <div className="mt-2 space-y-1 text-[11px] font-mono text-slate-400 break-all">
                    <div>
                      실행 파일:{" "}
                      <span className="text-slate-200">
                        {cli.resolvedBinary ?? "미설치 (대체 PowerShell 세션 지원)"}
                      </span>
                    </div>
                    {cli.wrapperBinary && (
                      <div>
                        Headroom 래퍼:{" "}
                        <span className="text-emerald-300">
                          {cli.wrapperBinary}
                        </span>
                      </div>
                    )}
                    <div>
                      설정 경로: <span className="text-slate-300">{cli.configPath}</span>
                    </div>
                    <div>
                      로그 경로: <span className="text-slate-300">{cli.logPath}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                      cli.installed
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                    }`}
                  >
                    {cli.installed ? "설치 확인됨" : "PATH 미감지"}
                  </span>
                  {cli.isCustom && (
                    <button
                      onClick={() => onDeleteCustomCli(cli.id)}
                      className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition"
                      title="커스텀 CLI 삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* 하단: 구독 상태 및 동작 버튼 (mt-auto로 모든 카드의 높이/버튼 위치 수평 정렬) */}
              <div className="mt-auto pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  {cli.subscriptionDetected ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      로컬 구독/설정 프로필 감지됨
                    </span>
                  ) : (
                    <span className="text-slate-500 font-medium">구독 로그인 필요</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* 1. Headroom 실행 버튼 */}
                  {cli.wrapperBinary && (
                    <button
                      onClick={() => onStartLoginSession(cli.id, "__WRAPPER__")}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition shadow-sm"
                      title={`${cli.name}을(를) Headroom 토큰 최적화 모드로 즉시 실행`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      Headroom 실행
                    </button>
                  )}

                  {/* 2. 일반 실행 버튼 */}
                  <button
                    onClick={() => onStartLoginSession(cli.id, "")}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-slate-100 text-xs font-semibold border border-slate-700 transition"
                    title={`${cli.name} 일반 CLI 터미널 실행`}
                  >
                    <Play className="w-3.5 h-3.5 text-cyan-400" />
                    실행
                  </button>

                  {/* 3. 로그인 버튼 */}
                  {cli.loginCommand && (
                    <button
                      onClick={() => onStartLoginSession(cli.id, cli.loginCommand)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/30 text-xs font-bold transition shadow-sm"
                      title={`${cli.loginCommand} 실행하여 구독 로그인 수행`}
                    >
                      <LogIn className="w-3.5 h-3.5 text-indigo-400" />
                      로그인
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. API 키 볼트 (세션별 환경변수 자동 주입) */}
      <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400" />
            2. API 키 볼트 (PTY 세션 시작 시 환경변수로 자동 주입)
          </h3>
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <FolderCog className="w-3.5 h-3.5" />
            난독화 저장 · 로그/파일 평문 노출 금지
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {apiKeys.map((k) => {
            const mapKey = `${k.cliId}:${k.keyName}`;
            const cliDef = clis.find((c) => c.id === k.cliId);
            return (
              <div
                key={mapKey}
                className="p-3.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: cliDef?.accentColor ?? "#6366f1" }}
                    />
                    <span className="text-xs font-bold text-slate-200 truncate">
                      {cliDef?.name ?? k.cliId}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      k.hasKey
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {k.hasKey ? "보관 중" : "미등록"}
                  </span>
                </div>

                <div className="text-[11px] font-mono text-indigo-300 font-semibold truncate">
                  ${k.keyName}
                </div>

                {k.hasKey && (
                  <div className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-1 rounded border border-slate-800/80 flex items-center justify-between">
                    <span>{k.maskedPreview}</span>
                    <button
                      onClick={() => onDeleteKey(k.cliId, k.keyName)}
                      className="text-rose-400 hover:text-rose-300 text-[10px] ml-2"
                    >
                      삭제
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-1.5">
                  <input
                    type="password"
                    placeholder={k.hasKey ? "새 키로 덮어쓰기..." : "API 키 값 입력..."}
                    value={inputs[mapKey] ?? ""}
                    onChange={(e) =>
                      setInputs((prev) => ({ ...prev, [mapKey]: e.target.value }))
                    }
                    className="flex-1 min-w-0 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => handleSave(k.cliId, k.keyName)}
                    className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shrink-0 transition"
                  >
                    저장
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 소프트웨어 버전 & 업데이트 확인 섹션 */}
      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/10 p-5 mt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <ArrowUpCircle className="w-4 h-4 text-indigo-400" />
            AgentriX 소프트웨어 버전: <span className="font-mono text-indigo-400 font-extrabold">v1.0.1</span>
          </h4>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            GitHub Releases를 통해 새로운 기능과 버그 수정이 포함된 최신 버전을 감지하고 업데이트합니다.
          </p>
        </div>
        {onCheckUpdate && (
          <button
            type="button"
            onClick={onCheckUpdate}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-md shadow-indigo-600/20 shrink-0 active:scale-95 flex items-center gap-1.5"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
            최신 버전 업데이트 확인
          </button>
        )}
      </div>

      {/* 공장 초기화 및 개인 설정 완전 삭제 섹션 */}
      {onResetAppData && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/10 p-5 mt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-bold text-rose-300 flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-400" />
              앱 데이터 및 설정 공장 초기화 (Clean Slate)
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              등록된 모든 작업 프로젝트, 토큰 사용 통계 기록, 팀원 목록, 로컬 캐시 및 프로필 설정을 싹 비우고 앱을 최초 설치 상태로 깨끗하게 되돌립니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onResetAppData}
            className="px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-500/40 text-xs font-bold transition shadow-sm shrink-0 active:scale-95"
          >
            모든 데이터 초기화
          </button>
        </div>
      )}
    </div>
  );
};
