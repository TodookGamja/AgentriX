import React from "react";
import { Cpu, RefreshCw, X, Zap } from "lucide-react";

export interface TokenOptimizationConfig {
  autoRelayEnabled: boolean;
  contextThresholdTokens: number;
  autoCompactFirst: boolean;
  syncToBlackboard: boolean;
  preserveRolePrompt: boolean;
  closeOldSession: boolean;
}

interface TokenOptimizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: TokenOptimizationConfig;
  onSaveConfig: (cfg: TokenOptimizationConfig) => void;
  onManualTriggerRelay?: () => void;
  activeSessionName?: string;
  activeSessionEstTokens?: number;
}

export const TokenOptimizationModal: React.FC<TokenOptimizationModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  onManualTriggerRelay,
  activeSessionName,
  activeSessionEstTokens = 0,
}) => {
  const [localCfg, setLocalCfg] = React.useState<TokenOptimizationConfig>(config);

  React.useEffect(() => {
    setLocalCfg(config);
  }, [config]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveConfig(localCfg);
    onClose();
  };

  const thresholdK = Math.round(localCfg.contextThresholdTokens / 1000);
  const currentK = Math.round(activeSessionEstTokens / 1000);
  const usagePct = Math.min(100, Math.round((activeSessionEstTokens / localCfg.contextThresholdTokens) * 100));

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* 헤더 */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100">
              토큰 사용량 최적화 & 스마트 세션 릴레이 (Auto-Handoff)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-5 text-xs overflow-y-auto flex-1 leading-relaxed">
          {/* 현재 활성 세션 상태 배너 */}
          {activeSessionName && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-indigo-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                  현재 선택된 세션: <b className="text-white">{activeSessionName}</b>
                </span>
                <span className="font-mono text-[11px] font-bold text-amber-300">
                  {currentK}k / {thresholdK}k 토큰 ({usagePct}%)
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    usagePct >= 85 ? "bg-rose-500" : usagePct >= 60 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
              {onManualTriggerRelay && (
                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      onManualTriggerRelay();
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-[11px] font-bold transition shadow-sm"
                  >
                    <RefreshCw className="w-3 h-3" />
                    지금 즉시 다음 세션으로 인수인계 릴레이 실행
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 1. 자동 세션 인수인계 마스터 스위치 */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                  <span>컨텍스트 한도 초과 시 자동 세션 인수인계 (Auto-Relay)</span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                    추천
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  대화가 길어져 토큰 소모가 급증할 때, 작업 맥락을 요약하여 깨끗한 새 세션으로 자동 전달합니다.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                <input
                  type="checkbox"
                  checked={localCfg.autoRelayEnabled}
                  onChange={(e) =>
                    setLocalCfg({ ...localCfg, autoRelayEnabled: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          </div>

          {/* 2. 임계치 슬라이더 */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-200 text-xs">
                인수인계 트리거 임계 토큰
              </label>
              <span className="font-mono text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                {thresholdK}k 토큰 ({localCfg.contextThresholdTokens.toLocaleString()} tokens)
              </span>
            </div>
            <input
              type="range"
              min="40000"
              max="180000"
              step="5000"
              value={localCfg.contextThresholdTokens}
              onChange={(e) =>
                setLocalCfg({
                  ...localCfg,
                  contextThresholdTokens: parseInt(e.target.value, 10),
                })
              }
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>40k (자주 교체 / 초절약)</span>
              <span>100k (표준 권장)</span>
              <span>180k (장문 유지)</span>
            </div>
          </div>

          {/* 3. 인수인계 상세 전략 옵션 */}
          <div className="space-y-2">
            <label className="font-bold text-slate-300 text-xs block">
              스마트 인수인계 세부 옵션
            </label>

            {/* 옵션 A: 새 세션 전 /compact 시도 */}
            <div
              onClick={() =>
                setLocalCfg({
                  ...localCfg,
                  autoCompactFirst: !localCfg.autoCompactFirst,
                })
              }
              className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer flex items-center justify-between transition"
            >
              <div>
                <div className="font-semibold text-slate-200 text-xs">
                  컨텍스트 초과 시 1차 `/compact` 압축 자동 시도
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  먼저 `/compact`를 1회 실행하여 세션을 연장하며, 컴팩트 1회 후에도 여전히 임계치를 초과할 때만 신규 세션으로 연계합니다.
                </div>
              </div>
              <input
                type="checkbox"
                checked={localCfg.autoCompactFirst}
                onChange={() => {}}
                className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700 focus:ring-0 shrink-0 ml-3"
              />
            </div>

            {/* 옵션 B: BLACKBOARD.md 자동 동기화 */}
            <div
              onClick={() =>
                setLocalCfg({
                  ...localCfg,
                  syncToBlackboard: !localCfg.syncToBlackboard,
                })
              }
              className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer flex items-center justify-between transition"
            >
              <div>
                <div className="font-semibold text-slate-200 text-xs">
                  `SESSION_HANDOFF.md` 및 `BLACKBOARD.md` 자동 파일 기록
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  직전 작업 로그, 에이전트 역할, 목표 지침을 md 파일로 저장하여 새 세션이 즉시 읽고 이어서 작업할 수 있도록 전달합니다.
                </div>
              </div>
              <input
                type="checkbox"
                checked={localCfg.syncToBlackboard}
                onChange={() => {}}
                className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700 focus:ring-0 shrink-0 ml-3"
              />
            </div>

            {/* 옵션 C: 에이전트 역할 지침 자동 계승 */}
            <div
              onClick={() =>
                setLocalCfg({
                  ...localCfg,
                  preserveRolePrompt: !localCfg.preserveRolePrompt,
                })
              }
              className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer flex items-center justify-between transition"
            >
              <div>
                <div className="font-semibold text-slate-200 text-xs">
                  새 세션에 에이전트 역할 지침(Role Briefing) 자동 계승
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  이전 에이전트의 페르소나, 역할 프롬프트, 행동 규칙을 새 세션 첫 메시지에 그대로 전달합니다.
                </div>
              </div>
              <input
                type="checkbox"
                checked={localCfg.preserveRolePrompt}
                onChange={() => {}}
                className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700 focus:ring-0 shrink-0 ml-3"
              />
            </div>

            {/* 옵션 D: 릴레이 완료 시 이전 세션 자동 종료 (PC 리소스 회수) */}
            <div
              onClick={() =>
                setLocalCfg({
                  ...localCfg,
                  closeOldSession: !localCfg.closeOldSession,
                })
              }
              className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer flex items-center justify-between transition"
            >
              <div>
                <div className="font-semibold text-emerald-300 text-xs flex items-center gap-1.5">
                  릴레이 완료 시 이전 세션 프로세스 즉시 종료 (PC 자원/메모리 회수)
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  새 세션에 md 파일로 인수인계가 완료되면, 이전 세션 PTY 프로세스를 즉시 종료하여 PC 메모리 누수와 과부하를 원천 방지합니다.
                </div>
              </div>
              <input
                type="checkbox"
                checked={localCfg.closeOldSession ?? true}
                onChange={() => {}}
                className="w-4 h-4 rounded text-emerald-600 bg-slate-900 border-slate-700 focus:ring-0 shrink-0 ml-3"
              />
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow"
          >
            설정 저장 및 적용
          </button>
        </div>
      </div>
    </div>
  );
};
