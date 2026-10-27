import React, { useState, useEffect } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  FolderCode,
  KeyRound,
  Loader2,
  Sparkles,
  Terminal,
  UserPlus,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import type {
  ApiKeyStatus,
  AiProviderConfig,
  AiProviderType,
  DetectedCliCredential,
  ProjectAgentInput,
  ProjectDeepContext,
} from "../types/types";
import { testAiConnection, generateDeepAiTeam, generateDeepAiTeamWithCli } from "../lib/aiDeepAnalyzer";
import { apiGetDetectedCliCredentials } from "../lib/tauriBridge";

interface AiDeepTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
  projectName: string;
  projectContext: ProjectDeepContext | null;
  savedApiKeys?: ApiKeyStatus[];
  onApplyDeepAgents: (agents: ProjectAgentInput[]) => void;
}

function maskKey(key: string): string {
  if (!key) return "******";
  if (key.length <= 10) return "******";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const PROVIDER_MODELS: Record<AiProviderType, { label: string; models: string[] }> = {
  anthropic: {
    label: "Anthropic Claude",
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
  },
  openai: {
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "o1-mini", "gpt-4-turbo"],
  },
  gemini: {
    label: "Google Gemini",
    models: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp"],
  },
  groq: {
    label: "Groq (초고속 Llama)",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  },
  ollama: {
    label: "로컬 Ollama (무료/오프라인)",
    models: ["llama3.2", "qwen2.5-coder", "deepseek-coder-v2", "mistral"],
  },
};

const DEFAULT_CONFIG: AiProviderConfig = {
  provider: "anthropic",
  apiKey: "",
  model: "claude-3-5-sonnet-20241022",
  baseUrl: "http://localhost:11434",
};

export const AiDeepTeamModal: React.FC<AiDeepTeamModalProps> = ({
  isOpen,
  onClose,
  projectPath,
  projectName,
  projectContext,
  savedApiKeys: _savedApiKeys,
  onApplyDeepAgents,
}) => {
  // 모드: "cli" (설치된 CLI 직접 연동) vs "api" (API 키 연동)
  const [activeTab, setActiveTab] = useState<"cli" | "api">("cli");
  const [selectedCli, setSelectedCli] = useState<string>("claude");

  const [detectedCreds, setDetectedCreds] = useState<DetectedCliCredential[]>([]);
  const [config, setConfig] = useState<AiProviderConfig>(() => {
    try {
      const v = localStorage.getItem("agentrix_deep_ai_config");
      if (v) return JSON.parse(v);
    } catch {}
    return DEFAULT_CONFIG;
  });

  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<{ testing: boolean; result?: { ok: boolean; message: string } }>({
    testing: false,
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [generatedAgents, setGeneratedAgents] = useState<ProjectAgentInput[]>([]);

  // 모달 열릴 때 로컬 감지된 CLI 크레덴셜 목록 조회
  useEffect(() => {
    if (!isOpen) return;
    setTestStatus({ testing: false });
    setAnalysisError(null);
    setGeneratedAgents([]);

    apiGetDetectedCliCredentials()
      .then((creds) => {
        setDetectedCreds(creds);
        // 만약 저장된 키가 없고 감지된 키가 있으면 기본값 자동 채움
        if (!config.apiKey && creds.length > 0) {
          const first = creds[0];
          setConfig((prev) => ({
            ...prev,
            provider: first.provider as AiProviderType,
            apiKey: first.rawKey,
            model: PROVIDER_MODELS[first.provider as AiProviderType]?.models[0] || prev.model,
          }));
        }
      })
      .catch((err) => {
        console.warn("Failed to fetch detected CLI credentials:", err);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleProviderChange = (provider: AiProviderType) => {
    const models = PROVIDER_MODELS[provider].models;
    setConfig((prev) => ({
      ...prev,
      provider,
      model: models[0] || "",
    }));
    setTestStatus({ testing: false });
  };

  const handleApplyDetectedCred = (cred: DetectedCliCredential) => {
    const prov = cred.provider as AiProviderType;
    const models = PROVIDER_MODELS[prov]?.models || [];
    setConfig((prev) => ({
      ...prev,
      provider: prov,
      apiKey: cred.rawKey,
      model: models[0] || prev.model,
    }));
    setTestStatus({
      testing: false,
      result: { ok: true, message: `[${cred.source}]에서 감지된 인증 키가 자동 적용되었습니다.` },
    });
  };

  const handleSaveConfig = () => {
    try {
      localStorage.setItem("agentrix_deep_ai_config", JSON.stringify(config));
    } catch {}
  };

  const handleTestConnection = async () => {
    setTestStatus({ testing: true });
    handleSaveConfig();
    const res = await testAiConnection(config);
    setTestStatus({ testing: false, result: res });
  };

  // 분석 실행: Tab에 따라 CLI 직접 실행 vs API 실행 분기
  const handleRunDeepAnalysis = async () => {
    if (!projectContext) {
      setAnalysisError("프로젝트 컨텍스트 정보를 읽어오지 못했습니다.");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      let agents: ProjectAgentInput[];
      if (activeTab === "cli") {
        // CLI 직접 연동 (API 키 불필요)
        agents = await generateDeepAiTeamWithCli(selectedCli, projectContext);
      } else {
        // API 키 연동
        if (!config.apiKey && config.provider !== "ollama") {
          throw new Error("AI API 키를 먼저 입력하고 저장해 주세요.");
        }
        handleSaveConfig();
        agents = await generateDeepAiTeam(config, projectContext);
      }
      setGeneratedAgents(agents);
    } catch (err: any) {
      setAnalysisError(err?.message || String(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmApply = () => {
    if (generatedAgents.length === 0) return;
    onApplyDeepAgents(generatedAgents);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* 헤더 */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-pink-500 flex items-center justify-center text-white shadow-md">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                AI 심층 팀빌딩 (AI Deep Team Builder)
                <span className="px-2 py-0.5 rounded-full bg-fuchsia-500/10 dark:bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-300 border border-fuchsia-500/30 text-[10px] font-semibold">
                  LLM 기획
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                연결된 AI가 프로젝트 코드베이스와 구조를 직접 읽고 최적의 전담팀을 기획합니다.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 탭 네비게이션: CLI 연동 (API 키 불필요) vs 직접 API 키 */}
        <div className="px-6 pt-3 pb-0 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("cli")}
            className={`px-3.5 py-2 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === "cli"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            설치된 AI CLI 직접 연동 (API 키 불필요 - 추천)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("api")}
            className={`px-3.5 py-2 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === "api"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            API 키 연동 (OpenAI, Gemini, Groq, Ollama)
          </button>
        </div>

        {/* 본문 스크롤 영역 */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* TAB 1: 설치된 AI CLI 직접 연동 */}
          {activeTab === "cli" && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <Terminal className="w-4 h-4 text-indigo-500" />
                  <span>분석에 사용할 로컬 AI CLI 선택</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  CLI 로그인 세션 활용
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                별도의 유료 API 키를 발급받지 않아도, 평소 터미널에서 로그인해 사용 중인 AI CLI 도구를 통해
                프로젝트 코드와 구조를 즉시 심층 분석하고 최적의 에이전트 팀을 기획합니다.
              </p>

              {/* CLI 라디오 선택 카드 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {[
                  {
                    id: "claude",
                    name: "Claude Code",
                    desc: "Anthropic Claude 최신 지능 (코드베이스 분석 탁월)",
                    badge: "추천",
                    color: "border-amber-500/40 text-amber-600 dark:text-amber-400",
                  },
                  {
                    id: "antigravity",
                    name: "Antigravity (AGY)",
                    desc: "Google DeepMind 에이전틱 코딩 CLI 엔진",
                    badge: "공식 연동",
                    color: "border-indigo-500/40 text-indigo-600 dark:text-indigo-400",
                  },
                  {
                    id: "codex",
                    name: "Codex CLI",
                    desc: "OpenAI 기반 터미널 코딩 에이전트",
                    badge: "OpenAI",
                    color: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
                  },
                  {
                    id: "grok",
                    name: "Grok CLI",
                    desc: "xAI 초고속 추론 에이전트",
                    badge: "xAI",
                    color: "border-purple-500/40 text-purple-600 dark:text-purple-400",
                  },
                ].map((item) => {
                  const isSelected = selectedCli === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedCli(item.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition text-left flex flex-col justify-between ${
                        isSelected
                          ? "bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-500 shadow-sm ring-1 ring-indigo-500/30"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                          <input
                            type="radio"
                            name="cli_choice"
                            checked={isSelected}
                            onChange={() => setSelectedCli(item.id)}
                            className="text-indigo-600 focus:ring-indigo-500"
                          />
                          {item.name}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${item.color}`}>
                          {item.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-4">{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: API 키 연동 (감지된 키 자동 채우기 포함) */}
          {activeTab === "api" && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <Cpu className="w-4 h-4 text-indigo-500" />
                  <span>분석에 사용할 AI 엔진 및 API 키 설정</span>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    Boolean(config.apiKey.trim()) || config.provider === "ollama"
                      ? "bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                      : "bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                  }`}
                >
                  {Boolean(config.apiKey.trim()) || config.provider === "ollama" ? "AI 연결됨" : "AI API 키 필요"}
                </span>
              </div>

              {/* 감지된 로컬 키 자동 채우기 버튼 바 */}
              {detectedCreds.length > 0 && (
                <div className="p-2.5 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 space-y-1.5">
                  <div className="text-[11px] font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    <span>로컬 환경 및 CLI에서 감지된 인증 키 (클릭 시 자동 적용)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedCreds.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleApplyDetectedCred(c)}
                        className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-indigo-300 dark:border-indigo-700/60 hover:border-indigo-500 text-[11px] font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition flex items-center gap-1.5"
                      >
                        <Zap className="w-3 h-3 text-amber-500" />
                        <span>{c.source}</span>
                        <span className="font-mono text-[10px] text-slate-400">{maskKey(c.rawKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 프로바이더 선택 */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(Object.keys(PROVIDER_MODELS) as AiProviderType[]).map((p) => {
                  const isSelected = config.provider === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleProviderChange(p)}
                      className={`px-2.5 py-2 rounded-lg border text-[11px] font-semibold transition text-center ${
                        isSelected
                          ? "bg-indigo-600 text-white border-indigo-500 shadow-sm"
                          : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                      }`}
                    >
                      {PROVIDER_MODELS[p].label.split(" ")[0]}
                    </button>
                  );
                })}
              </div>

              {/* API Key 입력 & 모델 선택 */}
              <div className="space-y-2 pt-1">
                {config.provider !== "ollama" ? (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                        <KeyRound className="w-3 h-3 text-indigo-500" />
                        {PROVIDER_MODELS[config.provider].label} API Key
                      </label>
                    </div>
                    <div className="relative">
                      <input
                        type={showKey ? "text" : "password"}
                        value={config.apiKey}
                        onChange={(e) => setConfig({ ...config, apiKey: e.target.value.trim() })}
                        placeholder={`${config.provider === "anthropic" ? "sk-ant-..." : config.provider === "openai" ? "sk-..." : "AI API 키를 입력하세요"}`}
                        className="w-full px-3 py-2 pr-10 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                      Ollama Base URL
                    </label>
                    <input
                      type="text"
                      value={config.baseUrl || "http://localhost:11434"}
                      onChange={(e) => setConfig({ ...config, baseUrl: e.target.value.trim() })}
                      placeholder="http://localhost:11434"
                      className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )}

                {/* 모델 선택 */}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                      모델 선택
                    </label>
                    <select
                      value={config.model}
                      onChange={(e) => setConfig({ ...config, model: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      {PROVIDER_MODELS[config.provider].models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="shrink-0 self-end">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testStatus.testing || (!config.apiKey && config.provider !== "ollama")}
                      className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
                    >
                      {testStatus.testing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                      ) : (
                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      연결 테스트
                    </button>
                  </div>
                </div>

                {/* 테스트 결과 피드백 */}
                {testStatus.result && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                      testStatus.result.ok
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300"
                    }`}
                  >
                    {testStatus.result.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                    )}
                    <span>{testStatus.result.message}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 섹션 2: 분석 대상 프로젝트 컨텍스트 요약 */}
          <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 font-semibold">
              <span className="flex items-center gap-1.5">
                <FolderCode className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                분석 대상: {projectName}
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[280px]">
                {projectPath}
              </span>
            </div>
            {projectContext && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {projectContext.detectedStacks.map((st) => (
                  <span
                    key={st}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] text-slate-700 dark:text-slate-300 font-mono font-medium"
                  >
                    {st}
                  </span>
                ))}
                <span className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-400">
                  파일 항목 {projectContext.fileTree.length}개 추출됨
                </span>
                {projectContext.readmeSnippet && (
                  <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-[10px] text-indigo-700 dark:text-indigo-300 font-medium">
                    README 내용 포함
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 분석 에러 메시지 */}
          {analysisError && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 dark:bg-rose-500/15 border border-rose-500/30 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{analysisError}</span>
            </div>
          )}

          {/* 생성된 에이전트 결과 프리뷰 */}
          {generatedAgents.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-fuchsia-500" />
                  AI가 기획한 전담팀 ({generatedAgents.length}명)
                </h3>
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
                  기획 완료! 확인 후 팀에 적용하세요.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {generatedAgents.map((ag) => (
                  <div
                    key={ag.name}
                    className="p-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5 relative overflow-hidden shadow-sm"
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-1"
                      style={{ backgroundColor: ag.accentColor }}
                    />
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xl">{ag.avatarEmoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">{ag.name}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-medium">
                          {ag.roleTitle}
                        </div>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-indigo-600 dark:text-indigo-300 font-semibold uppercase">
                        {ag.cliId}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                      {ag.rolePrompt}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 푸터 버튼 */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition"
          >
            닫기
          </button>

          <div className="flex items-center gap-2">
            {generatedAgents.length === 0 ? (
              <button
                type="button"
                onClick={handleRunDeepAnalysis}
                disabled={isAnalyzing || (activeTab === "api" && !config.apiKey && config.provider !== "ollama")}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg flex items-center gap-2 transition"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{activeTab === "cli" ? `${selectedCli.toUpperCase()}로 분석 및 기획 중...` : "AI가 프로젝트를 심층 분석 및 기획 중..."}</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    <span>{activeTab === "cli" ? `🚀 ${selectedCli.toUpperCase()}로 심층 팀빌딩 실행` : "AI 심층 팀빌딩 실행"}</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConfirmApply}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg flex items-center gap-2 transition"
              >
                <UserPlus className="w-4 h-4" />
                <span>이 AI 팀을 프로젝트에 즉시 적용</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
