import React, { useEffect, useRef, useState } from "react";
import { confirmDialogSubscribe, type ConfirmRequest } from "../lib/confirmDialog";

// 앱 어디서나 confirmDialog()로 여는 공용 확인 모달 (브라우저 기본 confirm/alert 대체). main.tsx에서 한 번만 마운트.
export const ConfirmHost: React.FC = () => {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => confirmDialogSubscribe((r) => setQueue((q) => [...q, r])), []);
  const cur = queue[0];
  const close = (v: boolean) => { cur?.resolve(v); setQueue((q) => q.slice(1)); };
  useEffect(() => { if (cur) (cur.danger && cancelRef.current ? cancelRef : okRef).current?.focus(); }, [cur]); // 위험 동작은 취소에 먼저 포커스(Enter 실수 방지)
  useEffect(() => {
    if (!cur) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cur.resolve(false); setQueue((q) => q.slice(1)); }
      else if (e.key === "Tab") { // 포커스 트랩: 버튼 둘 사이만 순환
        const btns = [cancelRef.current, okRef.current].filter(Boolean) as HTMLButtonElement[];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length]?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cur]);
  if (!cur) return null;
  const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 space-y-2">
          <h3 id="confirm-title" className="text-sm font-bold text-slate-100">{cur.title}</h3>
          {cur.message && <p className="text-xs text-slate-400 whitespace-pre-line leading-relaxed">{cur.message}</p>}
        </div>
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
          {!cur.infoOnly && (
            <button ref={cancelRef} type="button" onClick={() => close(false)} className={`px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 border border-slate-700 text-xs font-semibold transition-colors ${ring}`}>
              {cur.cancelLabel ?? "취소"}
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            onClick={() => close(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white ${cur.danger ? "bg-red-600 hover:bg-red-500" : "bg-indigo-600 hover:bg-indigo-500"} ${ring}`}
          >
            {cur.confirmLabel ?? "확인"}
          </button>
        </div>
      </div>
    </div>
  );
};
