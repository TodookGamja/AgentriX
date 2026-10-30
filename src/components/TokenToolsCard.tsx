import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, RefreshCw, XCircle } from "lucide-react";
import { apiCheckTokenTools, apiInstallTokenTool, type TokenToolStatus } from "../lib/tauriBridge";

interface TokenToolsCardProps {
  /** 설치 성공 후 CLI/래퍼 감지를 다시 돌리기 위한 콜백 */
  onInstalled?: () => void;
}

/** Headroom 등 토큰 절감 도구의 실행 전제(uv)·본체 설치 여부를 감지하고 클릭으로 설치 */
export const TokenToolsCard: React.FC<TokenToolsCardProps> = ({ onInstalled }) => {
  const [tools, setTools] = useState<TokenToolStatus[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [log, setLog] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => {
    apiCheckTokenTools().then(setTools).catch(() => setTools([]));
  }, []);
  useEffect(refresh, [refresh]);

  const install = async (id: string) => {
    setBusyId(id);
    setLog(null);
    try {
      const res = await apiInstallTokenTool(id);
      setLog({ ok: res.ok, text: res.output.slice(-1200) });
      if (res.ok) onInstalled?.();
    } catch (e) {
      setLog({ ok: false, text: String(e) });
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  if (!tools) return null;
  const missing = tools.filter((t) => !t.installed);

  return (
    <div className="rounded-2xl bg-slate-900/40 border border-slate-800/80 p-5 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100">토큰 절감 도구 설치 상태</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {missing.length === 0
              ? "필요한 도구가 모두 설치되어 있습니다."
              : "이 PC에 없는 도구가 있습니다. 설치해야 Headroom 기능을 쓸 수 있습니다. (Caveman 스킬은 앱에 내장되어 설치가 필요 없습니다)"}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          title="다시 검사"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        {tools.map((t) => (
          <div key={t.id} className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                {t.installed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span className="truncate">{t.name}</span>
                {t.version && <span className="font-mono text-[10px] text-slate-400">{t.version}</span>}
              </div>
              {!t.installed && (
                <p className="font-mono text-[10px] text-slate-500 break-all">실행 명령: {t.installCommand}</p>
              )}
              {!t.installed && t.requires && !t.requiresMet && (
                <p className="text-[10px] text-amber-400">먼저 {t.requires}를 설치해야 합니다.</p>
              )}
            </div>
            {!t.installed && (
              <button
                type="button"
                disabled={busyId !== null || !t.requiresMet}
                onClick={() => install(t.id)}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition"
              >
                {busyId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {busyId === t.id ? "설치 중..." : "설치"}
              </button>
            )}
          </div>
        ))}
      </div>

      {log && (
        <pre
          className={`max-h-40 overflow-auto p-2.5 rounded-lg text-[10px] whitespace-pre-wrap border ${
            log.ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200" : "bg-rose-500/10 border-rose-500/30 text-rose-200"
          }`}
        >
          {log.ok ? "설치 완료. 새로 연 터미널부터 적용됩니다.\n" : "설치 실패\n"}
          {log.text}
        </pre>
      )}
    </div>
  );
};
