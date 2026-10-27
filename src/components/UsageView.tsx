import React, { useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Cpu,
  DollarSign,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import type { CliQuotaStatus, UsageDashboardData } from "../types/types";

interface UsageViewProps {
  data: UsageDashboardData | null;
  cliFilter: string;
  onFilterChange: (cliId: string) => void;
  onSyncLogs: (timeframe?: string) => Promise<void>;
  timeframe: string;
  onTimeframeChange: (timeframe: string) => void;
}

const CLI_LABELS: Record<string, string> = {
  all: "전체 CLI 통합",
  claude: "Claude Code",
  codex: "Codex CLI",
  grok: "Grok CLI",
  cursor: "Cursor CLI",
  antigravity: "Antigravity (agy)",
};

const CLI_ACCENT: Record<string, { border: string; badge: string; dot: string; text: string; bg: string }> = {
  claude: {
    border: "border-orange-500/40",
    badge: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    dot: "bg-orange-400",
    text: "text-orange-400",
    bg: "bg-orange-500/10",
  },
  codex: {
    border: "border-emerald-500/40",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  grok: {
    border: "border-rose-500/40",
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    dot: "bg-rose-400",
    text: "text-rose-400",
    bg: "bg-rose-500/10",
  },
  cursor: {
    border: "border-sky-500/40",
    badge: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    dot: "bg-sky-400",
    text: "text-sky-400",
    bg: "bg-sky-500/10",
  },
  antigravity: {
    border: "border-violet-500/40",
    badge: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    dot: "bg-violet-400",
    text: "text-violet-400",
    bg: "bg-violet-500/10",
  },
};

const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtTok = (n: number) => compactFmt.format(n ?? 0);
const fullTok = (n: number) => (n ?? 0).toLocaleString();

const TIMEFRAME_OPTIONS: { id: string; label: string; desc: string; icon: string }[] = [
  { id: "5h", label: "최근 5시간", desc: "실시간 세션 한도", icon: "⏱️" },
  { id: "24h", label: "최근 24시간", desc: "오늘 하루 사용량", icon: "📅" },
  { id: "7d", label: "최근 7일 (기본)", desc: "주간 누적 및 모델 비교", icon: "🗓️" },
  { id: "all", label: "전체 기간", desc: "전체 세션 누적", icon: "🌐" },
];

// 리셋 시간 포맷 및 이미 지난 과거 시간 자동 검증 필터
const formatCleanReset = (raw?: string | null): string => {
  if (!raw) return "—";
  let s = raw.replace(/리셋\s*완료/g, "").replace(/리셋/g, "").replace(/오늘/g, "").replace(/[()]/g, "").trim();
  if (!s || s === "—" || s === "-") return "—";

  // "HH:mm" 포맷 검증: 오늘 기준 이미 지난 시간이면 "리셋 완료" 표시
  const match = s.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const now = new Date();
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target.getTime() < now.getTime() - 60000) {
      return "리셋 완료";
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // "MM/DD HH:mm" 포맷 검증
  const dateMatch = s.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1], 10) - 1;
    const day = parseInt(dateMatch[2], 10);
    const h = parseInt(dateMatch[3], 10);
    const m = parseInt(dateMatch[4], 10);
    const now = new Date();
    const target = new Date(now.getFullYear(), month, day, h, m, 0);
    if (target.getTime() < now.getTime() - 60000) {
      return "리셋 완료";
    }
  }

  return s;
};

export const UsageView: React.FC<UsageViewProps> = ({
  data,
  cliFilter,
  onFilterChange,
  onSyncLogs,
  timeframe,
  onTimeframeChange,
}) => {
  const [syncing, setSyncing] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [breakdownCliFilter, setBreakdownCliFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"total" | "cost" | "input" | "output" | "cache">("total");
  const breakdownRef = useRef<HTMLDivElement>(null);

  // 동적 CLI 필터 목록: 백엔드 쿼터 목록 + 기본/사용자 추가 CLI 자동 반영 (OpenCode, Cursor 등)
  const dynamicCliFilters = useMemo(() => {
    const list: { id: string; label: string; dot: string }[] = [
      { id: "all", label: "전체 CLI 통합", dot: "" },
    ];
    const seen = new Set<string>(["all"]);

    // 1) 쿼터 데이터에 포함된 모든 CLI
    for (const q of (data?.cliQuotas ?? [])) {
      if (!seen.has(q.cliId)) {
        seen.add(q.cliId);
        list.push({
          id: q.cliId,
          label: q.cliName || CLI_LABELS[q.cliId] || q.cliId,
          dot: CLI_ACCENT[q.cliId]?.dot ?? "bg-indigo-400",
        });
      }
    }

    // 2) 기본 CLI 누락 방지
    const defaults = [
      { id: "claude", label: "Claude Code" },
      { id: "codex", label: "Codex CLI" },
      { id: "grok", label: "Grok CLI" },
      { id: "antigravity", label: "Antigravity (agy)" },
      { id: "cursor", label: "Cursor Agent CLI" },
      { id: "opencode", label: "OpenCode CLI" },
    ];
    for (const d of defaults) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        list.push({
          id: d.id,
          label: d.label,
          dot: CLI_ACCENT[d.id]?.dot ?? "bg-indigo-400",
        });
      }
    }
    return list;
  }, [data?.cliQuotas]);

  const scrollToBreakdown = () => {
    breakdownRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSyncLogs(timeframe);
    } finally {
      setSyncing(false);
    }
  };

  // 상단 바 차트에 바인딩할 모델 목록: cliFilter가 'all'이 아니면 해당 CLI 모델만 엄격히 필터링
  const chartModels = useMemo(() => {
    let list = [...(data?.modelBreakdown ?? [])];
    if (cliFilter !== "all") {
      list = list.filter((item) => {
        const c = item.cliId.toLowerCase();
        const m = item.modelName.toLowerCase();
        if (cliFilter === "antigravity") {
          return c === "antigravity" || m.includes("gemini") || m.includes("agy");
        }
        if (cliFilter === "codex") {
          return c === "codex" || m.includes("codex") || m.includes("gpt");
        }
        if (cliFilter === "claude") {
          return (c === "claude" || m.includes("claude")) && !m.includes("agy");
        }
        if (cliFilter === "grok") {
          return c === "grok" || m.includes("grok");
        }
        if (cliFilter === "cursor") {
          return c === "cursor";
        }
        return c === cliFilter.toLowerCase();
      });
    }
    return list.slice(0, 8);
  }, [data?.modelBreakdown, cliFilter]);

  // 모델별 브레이크다운 필터링 및 정렬
  const filteredBreakdown = useMemo(() => {
    let list = [...(data?.modelBreakdown ?? [])];
    const activeCli = breakdownCliFilter !== "all" ? breakdownCliFilter : cliFilter;
    if (activeCli !== "all") {
      list = list.filter((item) => {
        const c = item.cliId.toLowerCase();
        const m = item.modelName.toLowerCase();
        if (activeCli === "antigravity") return c === "antigravity" || m.includes("gemini") || m.includes("agy");
        if (activeCli === "codex") return c === "codex" || m.includes("codex") || m.includes("gpt");
        if (activeCli === "claude") return (c === "claude" || m.includes("claude")) && !m.includes("agy");
        if (activeCli === "grok") return c === "grok" || m.includes("grok");
        return c === activeCli.toLowerCase();
      });
    }
    if (modelSearch.trim()) {
      const q = modelSearch.toLowerCase().trim();
      list = list.filter((item) => item.modelName.toLowerCase().includes(q) || item.cliId.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      switch (sortBy) {
        case "cost":
          return b.costUsd - a.costUsd;
        case "input":
          return b.inputTokens - a.inputTokens;
        case "output":
          return b.outputTokens - a.outputTokens;
        case "cache":
          return b.cacheTokens - a.cacheTokens;
        case "total":
        default:
          return b.totalTokens - a.totalTokens;
      }
    });
    return list;
  }, [data?.modelBreakdown, breakdownCliFilter, cliFilter, modelSearch, sortBy]);

  // 상위 3개 모델 하이라이트 (선택된 CLI 필터 반영)
  const topModels = useMemo(() => {
    return filteredBreakdown.slice(0, 3);
  }, [filteredBreakdown]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        사용량 데이터를 불러오는 중입니다...
      </div>
    );
  }

  const quotas: CliQuotaStatus[] = data.cliQuotas ?? [];

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 space-y-6 pb-48 bg-slate-950">
      {/* =====================================================================
          상단 헤더: CLI 필터 + 기간 윈도우 토글 + 새로고침 버튼
         ===================================================================== */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 sm:p-5 space-y-3.5 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2 truncate">
              <Activity className="w-5 h-5 text-indigo-400 shrink-0" />
              <span>사용량 · 구독 쿼터</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              실시간 구독 한도 및 세션 소비 모니터링
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={scrollToBreakdown}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700/80 text-xs font-semibold transition shadow-sm active:scale-[0.98]"
              title="모델별 · CLI별 상세 내역 표로 바로 스크롤 이동"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">모델별 상세 보기 ↓</span>
              <span className="sm:hidden">상세 ↓</span>
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold transition shadow-sm active:scale-[0.98]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span>{syncing ? "갱신 중..." : "새로고침"}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500 shrink-0">기간</span>
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              {TIMEFRAME_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onTimeframeChange(opt.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                    timeframe === opt.id
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                  }`}
                  title={opt.desc}
                >
                  {opt.label.replace(" (기본)", "")}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 shrink-0">CLI 대상</span>
            <div className="flex flex-wrap items-center bg-slate-950 p-1 rounded-xl border border-slate-800 gap-0.5">
              {dynamicCliFilters.map((cli) => (
                <button
                  key={cli.id}
                  onClick={() => onFilterChange(cli.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                    cliFilter === cli.id
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                  }`}
                >
                  {cli.id !== "all" && (
                    <span className={`w-1.5 h-1.5 rounded-full ${cli.dot}`} />
                  )}
                  {cli.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          1. CLI별 공식 구독 한도 및 세션 쿼터 카드
          - 'all' (전체 CLI 통합) 선택 시: Claude, Codex, Grok, Antigravity, Cursor, OpenCode 및 추가된 모든 CLI 동시 표시
          - 개별 CLI 선택 시: 선택된 CLI의 카드만 1개 단독으로 집중 표시!
         ===================================================================== */}
      {(() => {
        const cardsToRender = (() => {
          if (cliFilter !== "all") {
            const found = quotas.find((q) => q.cliId === cliFilter);
            if (found) return [found];
            return [
              {
                cliId: cliFilter,
                cliName: CLI_LABELS[cliFilter] ?? cliFilter,
                planLabel: "CLI 연동 중",
                sourceLabel: "텔레메트리 연동 준비 중",
                hasOfficialQuota: false,
                usedPercent5h: 0,
                remainingPercent5h: 100,
                resetsAt5h: null,
                usedPercentWeekly: 0,
                remainingPercentWeekly: 100,
                resetsAtWeekly: null,
                statusMessage: null,
              } as CliQuotaStatus,
            ];
          }

          const result = [...quotas];
          const seen = new Set(result.map((q) => q.cliId));
          const standardList = [
            { id: "claude", name: "Claude Code", plan: "Claude Pro" },
            { id: "codex", name: "Codex CLI", plan: "ChatGPT Plus" },
            { id: "grok", name: "Grok CLI", plan: "SuperGrok" },
            { id: "antigravity", name: "Antigravity (agy)", plan: "Google DeepMind" },
            { id: "cursor", name: "Cursor Agent CLI", plan: "Cursor Pro" },
            { id: "opencode", name: "OpenCode CLI", plan: "OpenCode OSS" },
          ];

          for (const s of standardList) {
            if (!seen.has(s.id)) {
              seen.add(s.id);
              result.push({
                cliId: s.id,
                cliName: s.name,
                planLabel: s.plan,
                sourceLabel: "텔레메트리 연동 준비 중",
                hasOfficialQuota: false,
                usedPercent5h: 0,
                remainingPercent5h: 100,
                resetsAt5h: null,
                usedPercentWeekly: 0,
                remainingPercentWeekly: 100,
                resetsAtWeekly: null,
                statusMessage: null,
              } as CliQuotaStatus);
            }
          }
          return result;
        })();

        return (
          <div
            className={`grid gap-3.5 ${
              cliFilter === "all"
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-3"
                : "grid-cols-1"
            }`}
          >
            {cardsToRender.map((q) => {
              const style = CLI_ACCENT[q.cliId] ?? {
                border: "border-slate-700",
                badge: "bg-slate-800 text-slate-300 border-slate-700",
                dot: "bg-indigo-400",
                text: "text-indigo-400",
                bg: "bg-indigo-500/10",
              };
              const isSelected = cliFilter === q.cliId;
              const used5h = Math.round(q.usedPercent5h);
              const remain5h = Math.round(q.remainingPercent5h);
              const usedWk = Math.round(q.usedPercentWeekly);
              const remainWk = Math.round(q.remainingPercentWeekly);
              const isExhausted5h = used5h >= 100;
              const isHighWeekly = usedWk >= 85;

              const label5h =
                q.cliId === "grok"
                  ? "통합 세션 한도"
                  : q.cliId === "antigravity"
                  ? "5시간 세션 (기본 Gemini)"
                  : "5시간 세션 한도";

              const labelWk =
                q.cliId === "antigravity"
                  ? "주간 한도 (기본 Gemini)"
                  : "주간 한도 (7일)";

              return (
                <div
                  key={q.cliId}
                  onClick={() => onFilterChange(q.cliId)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-3 shadow-sm hover:border-slate-700 ${
                    isSelected
                      ? `bg-slate-900 ${style.border} ring-1 ring-indigo-500/50 shadow-md`
                      : "bg-slate-900/80 border-slate-800"
                  }`}
                >
                  {/* 상단 1행: 이름 + 플랜 뱃지 + 상태 뱃지 (절대 겹치지 않도록 min-w-0 및 truncate 적용) */}
                  <div className="flex items-center justify-between gap-1.5 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                      <span className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        {q.cliName}
                      </span>
                      {q.planLabel && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold border truncate max-w-[90px] shrink-0 ${style.badge}`}
                          title={q.planLabel}
                        >
                          {q.planLabel}
                        </span>
                      )}
                    </div>

                    <div className="shrink-0">
                      {q.hasOfficialQuota ? (
                        isExhausted5h ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            소진
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            연동됨
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-medium">
                          텔레메트리
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 5시간 세션 한도 게이지 */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-semibold truncate">{label5h}</span>
                      <span
                        className={`font-mono text-sm font-extrabold shrink-0 ml-2 ${
                          remain5h <= 10 ? "text-rose-400" : "text-emerald-400"
                        }`}
                      >
                        {remain5h}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          used5h >= 90
                            ? "bg-rose-500"
                            : used5h >= 60
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                        style={{ width: `${Math.min(100, used5h)}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center justify-between font-mono pt-0.5 h-4">
                      <span className="shrink-0 text-slate-500 text-[10px]">초기화</span>
                      <span className="text-amber-300 font-medium truncate text-right ml-2 text-[10px]">
                        {formatCleanReset(q.resetsAt5h)}
                      </span>
                    </div>
                  </div>

                  {/* 주간 한도 게이지 */}
                  <div className="space-y-1 pt-1.5 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-semibold truncate">{labelWk}</span>
                      <span
                        className={`font-mono text-sm font-extrabold shrink-0 ml-2 ${
                          remainWk <= 15 ? "text-rose-400" : "text-indigo-300"
                        }`}
                      >
                        {remainWk}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isHighWeekly
                            ? "bg-rose-500"
                            : "bg-indigo-500"
                        }`}
                        style={{ width: `${Math.min(100, usedWk)}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center justify-between font-mono pt-0.5 h-4">
                      <span className="shrink-0 text-slate-500 text-[10px]">주간 리셋</span>
                      <span className="text-indigo-300 font-medium truncate text-right ml-2 text-[10px]">
                        {formatCleanReset(q.resetsAtWeekly)}
                      </span>
                    </div>
                  </div>

                  {/* 기타 모델 그룹별 개별 쿼터 (예: Antigravity의 Claude and GPT models, Gemini 4 Argon 등) */}
                  {q.subGroups && q.subGroups.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-2">
                      <div className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                          <span>기타 모델별 개별 쿼터</span>
                        </span>
                        <span className="text-[10px] text-slate-500 font-normal">별도 한도</span>
                      </div>
                      <div className="space-y-1.5">
                        {q.subGroups
                          .filter((g) => !g.name.toLowerCase().includes("gemini models"))
                          .map((g, idx) => {
                            const r5h = g.remaining5h != null ? Math.round(g.remaining5h) : null;
                            const rWk = g.remainingWeekly != null ? Math.round(g.remainingWeekly) : null;
                            const isExhausted = (r5h != null && r5h <= 0) || (rWk != null && rWk <= 0);

                            return (
                              <div
                                key={idx}
                                className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1 text-[11px]"
                              >
                                <div className="flex items-center justify-between gap-1.5 min-w-0">
                                  <span className="font-semibold text-slate-200 truncate">{g.name}</span>
                                  {isExhausted && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0">
                                      소진
                                    </span>
                                  )}
                                </div>
                                {g.description && (
                                  <div className="text-[10px] text-slate-500 line-clamp-1 truncate font-normal">
                                    {g.description}
                                  </div>
                                )}
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[10px] font-mono">
                                  {r5h != null && (
                                    <div className="flex items-center gap-1">
                                      <span className="text-slate-400">5h 잔여:</span>
                                      <span className={r5h <= 10 ? "text-rose-400 font-bold" : "text-emerald-400 font-semibold"}>
                                        {r5h}%
                                      </span>
                                      {g.resetsAt5h && (
                                        <span className="text-amber-300/80 text-[9px]">({formatCleanReset(g.resetsAt5h)})</span>
                                      )}
                                    </div>
                                  )}
                                  {rWk != null && (
                                    <div className="flex items-center gap-1">
                                      <span className="text-slate-400">주간 잔여:</span>
                                      <span className={rWk <= 15 ? "text-rose-400 font-bold" : "text-indigo-300 font-semibold"}>
                                        {rWk}%
                                      </span>
                                      {g.resetsAtWeekly && (
                                        <span className="text-indigo-300/80 text-[9px]">({formatCleanReset(g.resetsAtWeekly)})</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* 하단 출처 메타 */}
                  <div className="pt-1 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500">
                    <span className="truncate">{q.sourceLabel ?? "로컬 텔레메트리"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* =====================================================================
          2. 실시간 토큰 사용량 & 비용 절감 KPI 요약 (중복 쿼터 제거, 가독성/타이포그래피 최적화)
         ===================================================================== */}
      {(() => {
        const activeTimeframeLabel =
          TIMEFRAME_OPTIONS.find((t) => t.id === timeframe)?.label.replace(
            " (기본)",
            ""
          ) ?? "최근 7일";

        const totalTokensSum = (data.modelBreakdown ?? []).reduce(
          (acc, m) => acc + (m.totalTokens || 0),
          0
        );

        const timeframeTokens =
          timeframe === "5h"
            ? data.rolling5hTokens
            : timeframe === "all"
            ? totalTokensSum || data.weeklyTokens
            : data.weeklyTokens;

        const estSavedDollars = (
          (data.estimatedSavedTokens || 0) * 0.000003
        ).toFixed(1);

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3.5">
            {/* KPI 1: 실시간 소비 토큰 (최근 1시간) */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between space-y-2.5 shadow-xs hover:border-slate-700 transition">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 truncate">
                  <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">실시간 소비 토큰</span>
                </span>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold border border-emerald-500/20 shrink-0">
                  최근 1시간
                </span>
              </div>
              <div>
                <div className="text-2xl sm:text-3xl font-extrabold text-slate-100 font-mono tracking-tight flex items-baseline gap-1.5">
                  <span title={fullTok(data.currentTokens)}>
                    {fmtTok(data.currentTokens)}
                  </span>
                  <span className="text-xs font-normal text-slate-400 font-sans">
                    tokens
                  </span>
                </div>
                <div className="text-[11px] text-emerald-400 font-medium mt-1 truncate">
                  최근 5시간 누적 {fmtTok(data.rolling5hTokens)} tokens
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 truncate">
                터미널 세션 실시간 반영
              </div>
            </div>

            {/* KPI 2: 조회 기간 누적 사용량 */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between space-y-2.5 shadow-xs hover:border-slate-700 transition">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 truncate">
                  <BarChart3 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="truncate">기간 누적 토큰</span>
                </span>
                <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 text-[10px] font-semibold border border-indigo-500/20 shrink-0">
                  {activeTimeframeLabel}
                </span>
              </div>
              <div>
                <div className="text-2xl sm:text-3xl font-extrabold text-slate-100 font-mono tracking-tight flex items-baseline gap-1.5">
                  <span title={fullTok(timeframeTokens)}>
                    {fmtTok(timeframeTokens)}
                  </span>
                  <span className="text-xs font-normal text-slate-400 font-sans">
                    tokens
                  </span>
                </div>
                <div className="text-[11px] text-indigo-300 font-medium mt-1 truncate">
                  전체 누적 {fmtTok(totalTokensSum || data.weeklyTokens)} tokens
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 truncate">
                선택된 기간 기준 집계
              </div>
            </div>

            {/* KPI 3: Headroom + Caveman 절감 효과 */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between space-y-2.5 shadow-xs hover:border-slate-700 transition">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 truncate">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">토큰 절감 효과</span>
                </span>
                <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 text-[10px] font-semibold border border-cyan-500/20 shrink-0">
                  Headroom · Caveman
                </span>
              </div>
              <div>
                <div className="text-2xl sm:text-3xl font-extrabold text-cyan-400 font-mono tracking-tight flex items-baseline gap-1.5">
                  <span title={fullTok(data.estimatedSavedTokens)}>
                    {fmtTok(data.estimatedSavedTokens)}
                  </span>
                  <span className="text-xs font-normal text-slate-400 font-sans">
                    tok 절약
                  </span>
                </div>
                <div className="text-[11px] text-emerald-400 font-medium mt-1 truncate">
                  한도 소진 속도 약 42% 절감 효과
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 truncate">
                컨텍스트 압축 & 중복 출력 억제
              </div>
            </div>

            {/* KPI 4: 예상 비용 절감액 */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between space-y-2.5 shadow-xs hover:border-slate-700 transition">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 truncate">
                  <DollarSign className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">예상 비용 절감 효과</span>
                </span>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 text-[10px] font-semibold border border-amber-500/20 shrink-0">
                  절감 환산
                </span>
              </div>
              <div>
                <div className="text-2xl sm:text-3xl font-extrabold text-amber-300 font-mono tracking-tight flex items-baseline gap-1.5">
                  <span>~${estSavedDollars}</span>
                  <span className="text-xs font-normal text-slate-400 font-sans">
                    절약 가치
                  </span>
                </div>
                <div className="text-[11px] text-amber-300 font-medium mt-1 truncate">
                  캐시 히트 및 불필요 토큰 억제 환산
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 truncate">
                주요 API 표준 단가 기준 추산
              </div>
            </div>
          </div>
        );
      })()}

      {/* =====================================================================
          3. 차트 영역:
             1) 일별 CLI 사용량 히스토리
             2) 모델별 토큰 구조 비교 (Input / Output / Cache) - 선택된 기간(5h / 24h / 7d / all) 반영
         ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              일별 사용량 히스토리 추이 (CLI별 비교)
            </h3>
            <span className="text-[11px] text-slate-400">최근 14일</span>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            일자별 Claude Code, Codex, Grok, Cursor, Antigravity 토큰 소비량 추이
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.dailyHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={fmtTok} width={48} />
                <Tooltip
                  formatter={(v: number) => fullTok(v)}
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                {(cliFilter === "all" || cliFilter === "claude") && (
                  <Area
                    type="monotone"
                    dataKey="claudeTokens"
                    name="Claude Code"
                    stackId={cliFilter === "all" ? "1" : undefined}
                    stroke="#f97316"
                    fill="#f97316"
                    fillOpacity={cliFilter === "claude" ? 0.6 : 0.35}
                  />
                )}
                {(cliFilter === "all" || cliFilter === "codex") && (
                  <Area
                    type="monotone"
                    dataKey="codexTokens"
                    name="Codex CLI"
                    stackId={cliFilter === "all" ? "1" : undefined}
                    stroke="#10b981"
                    fill="#10b981"
                    fillOpacity={cliFilter === "codex" ? 0.6 : 0.35}
                  />
                )}
                {(cliFilter === "all" || cliFilter === "antigravity") && (
                  <Area
                    type="monotone"
                    dataKey="antigravityTokens"
                    name="Antigravity"
                    stackId={cliFilter === "all" ? "1" : undefined}
                    stroke="#8b5cf6"
                    fill="#8b5cf6"
                    fillOpacity={cliFilter === "antigravity" ? 0.6 : 0.35}
                  />
                )}
                {(cliFilter === "all" || cliFilter === "cursor") && (
                  <Area
                    type="monotone"
                    dataKey="cursorTokens"
                    name="Cursor CLI"
                    stackId={cliFilter === "all" ? "1" : undefined}
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={cliFilter === "cursor" ? 0.6 : 0.35}
                  />
                )}
                {(cliFilter === "all" || cliFilter === "grok") && (
                  <Area
                    type="monotone"
                    dataKey="grokTokens"
                    name="Grok CLI"
                    stackId={cliFilter === "all" ? "1" : undefined}
                    stroke="#ef4444"
                    fill="#ef4444"
                    fillOpacity={cliFilter === "grok" ? 0.6 : 0.35}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-indigo-400" />
              모델별 토큰 구조 비교 (Input / Output / Cache)
            </h3>
            <span className="px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold">
              {TIMEFRAME_OPTIONS.find((t) => t.id === timeframe)?.label ?? "최근 7일"} 기준
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            선택된 기간 내 실제 모델별 프롬프트 입력, 생성 출력, 캐시 히트 토큰 비교 분석
          </p>
          <div className="h-64 w-full">
            {chartModels && chartModels.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartModels}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="modelName" stroke="#94a3b8" fontSize={10} interval={0} angle={-15} textAnchor="end" height={40} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={fmtTok} width={48} />
                  <Tooltip
                    formatter={(v: number) => fullTok(v)}
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Bar dataKey="inputTokens" name="Input 토큰" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outputTokens" name="Output 토큰" fill="#ec4899" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cacheTokens" name="Cache 토큰" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
                <Cpu className="w-8 h-8 text-slate-600" />
                <span className="text-xs">선택된 기간({TIMEFRAME_OPTIONS.find((t) => t.id === timeframe)?.label}) 내 기록된 모델 사용량이 없습니다.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =====================================================================
          4. 모델별·CLI별 상세 사용량 Breakdown (핵심 사용자 요청 기능 강화)
         ===================================================================== */}
      <div
        ref={breakdownRef}
        id="model-breakdown-section"
        className="rounded-2xl bg-slate-900/90 border border-slate-800/90 overflow-hidden shadow-lg space-y-4 p-5 scroll-mt-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-400" />
              모델별 · CLI별 상세 사용량 Breakdown
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              각 AI 모델의 Input, Output, Cache 히트 토큰, 점유율 및 예상 소비 비용 상세 분석 ({TIMEFRAME_OPTIONS.find((t) => t.id === timeframe)?.label} 기준)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* 검색창 */}
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 absolute left-3 text-slate-400 pointer-events-none" />
              <input
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="모델명/CLI 검색..."
                className="h-9 pl-9 pr-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-44 transition"
              />
            </div>

            {/* 정렬 셀렉터 (이중 박스 없는 단일 라운드 필) */}
            <div className="relative flex items-center">
              <ArrowUpDown className="w-3.5 h-3.5 absolute left-3 text-indigo-400 pointer-events-none" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="clean-select h-9 pl-8 pr-7 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold text-slate-200 hover:border-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer transition appearance-none"
              >
                <option value="total" className="bg-[#0b0f19] text-slate-100">정렬: 총 토큰순</option>
                <option value="cost" className="bg-[#0b0f19] text-slate-100">정렬: 비용($)순</option>
                <option value="input" className="bg-[#0b0f19] text-slate-100">정렬: Input순</option>
                <option value="output" className="bg-[#0b0f19] text-slate-100">정렬: Output순</option>
                <option value="cache" className="bg-[#0b0f19] text-slate-100">정렬: Cache순</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* 상위 점유율 모델 하이라이트 카드 3종 */}
        {topModels.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {topModels.map((m, idx) => {
              const accent = CLI_ACCENT[m.cliId] ?? {
                border: "border-indigo-500/30",
                badge: "bg-indigo-500/20 text-indigo-300",
                dot: "bg-indigo-400",
                text: "text-indigo-400",
                bg: "bg-indigo-500/10",
              };
              return (
                <div
                  key={`top-${m.cliId}-${m.modelName}`}
                  className={`p-3.5 rounded-xl border ${accent.border} ${accent.bg} flex items-center justify-between gap-3`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-white/10 text-slate-300">
                        TOP {idx + 1}
                      </span>
                      <span className={`text-[10px] font-bold uppercase ${accent.text}`}>
                        {m.cliId}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-slate-100 font-mono truncate">
                      {m.modelName}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      점유율: <span className="font-bold text-indigo-300">{m.percentage.toFixed(1)}%</span> · ${(m.costUsd).toFixed(3)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-extrabold text-slate-100 font-mono">
                      <span title={fullTok(m.totalTokens)}>{fmtTok(m.totalTokens)}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">tokens</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* CLI 카테고리 탭 필터 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {["all", "claude", "codex", "grok", "cursor", "antigravity"].map((cid) => (
            <button
              key={`breakdown-tab-${cid}`}
              onClick={() => setBreakdownCliFilter(cid)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                breakdownCliFilter === cid
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800"
              }`}
            >
              {CLI_LABELS[cid]}
            </button>
          ))}
          <span className="text-xs text-slate-500 ml-auto whitespace-nowrap">
            {filteredBreakdown.length}개 모델 표시 중
          </span>
        </div>

        {/* 상세 테이블 */}
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/80 font-medium">
                <th className="py-3 px-4">모델명</th>
                <th className="py-3 px-4">CLI 도구</th>
                <th className="py-3 px-4 text-right">Input 토큰</th>
                <th className="py-3 px-4 text-right">Output 토큰</th>
                <th className="py-3 px-4 text-right">Cache 토큰</th>
                <th className="py-3 px-4 text-right">총 토큰 합계</th>
                <th className="py-3 px-4 text-right">기간 점유율</th>
                <th className="py-3 px-4 text-right">예상 비용</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredBreakdown.length > 0 ? (
                filteredBreakdown.map((item) => {
                  const style = CLI_ACCENT[item.cliId] ?? {
                    border: "border-slate-700",
                    badge: "bg-slate-800 text-slate-300 border-slate-700",
                    dot: "bg-indigo-400",
                    text: "text-slate-300",
                    bg: "bg-slate-800/40",
                  };
                  const cacheRatio = item.totalTokens > 0 ? Math.round((item.cacheTokens / item.totalTokens) * 100) : 0;

                  return (
                    <tr
                      key={`${item.cliId}-${item.modelName}`}
                      className="hover:bg-slate-900/60 transition"
                    >
                      <td className="py-3 px-4 font-bold text-slate-100 flex items-center gap-2">
                        <Cpu className={`w-3.5 h-3.5 ${style.text}`} />
                        <span>{item.modelName}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase ${style.badge}`}>
                          {item.cliId}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-indigo-300">
                        {item.inputTokens.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right text-pink-300">
                        {item.outputTokens.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right text-teal-300">
                        <div className="flex items-center justify-end gap-1.5">
                          <span>{item.cacheTokens.toLocaleString()}</span>
                          {cacheRatio > 0 && (
                            <span className="text-[10px] px-1 py-0.2 rounded bg-teal-500/15 text-teal-300 border border-teal-500/30">
                              {cacheRatio}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-extrabold text-slate-100">
                        {item.totalTokens.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden hidden sm:block">
                            <div
                              className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full"
                              style={{ width: `${Math.min(100, item.percentage)}%` }}
                            />
                          </div>
                          <span className="font-bold text-indigo-300">{item.percentage.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-emerald-400 font-bold">
                        ${item.costUsd.toFixed(4)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                    검색 조건에 맞는 모델 사용량 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
