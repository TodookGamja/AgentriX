import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, X } from "lucide-react";
import { TaskApprovalBoard } from "./TaskApprovalBoard";
import { panelMaxHeight } from "../lib/boardDone";
import type { ProjectAgentRecord } from "../types/types";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// 작업보드 상시 보기: 프로젝트 화면과 같은 칸반(승인 대기/진행 중/완료/반려)을 헤더 팝업으로 띄운다
export function BoardPanel({ projectPath, agents }: { projectPath: string; agents: ProjectAgentRecord[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 48, maxH: 600 });
  const boxRef = useRef<HTMLDivElement>(null); // 버튼
  const panelRef = useRef<HTMLDivElement>(null); // body 포털 팝업

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boxRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    // 창(viewport) 기준 배치: 버튼 하단 아래에서 시작, 아래 끝이 창 밖으로 잘리지 않게 높이 제한
    const fit = () => {
      if (!boxRef.current) return;
      const bottom = boxRef.current.getBoundingClientRect().bottom;
      setPos({ top: bottom + 8, maxH: panelMaxHeight(window.innerHeight, bottom) });
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 border font-semibold ${FOCUS_RING} ${
          open
            ? "bg-indigo-600 border-indigo-500 text-white"
            : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
        }`}
        title="작업보드 보기"
      >
        <ClipboardList className="w-3.5 h-3.5" />
        <span className="hidden md:inline">작업보드</span>
      </button>
      {open && createPortal(
        <div ref={panelRef} style={{ top: pos.top, maxHeight: pos.maxH }} className="fixed right-4 z-[60] w-[min(1400px,calc(100vw-2rem))] flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-3 text-xs text-slate-200">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="font-bold">작업보드 (3초마다 갱신)</span>
            <button onClick={() => setOpen(false)} className={`p-0.5 rounded text-slate-400 hover:text-slate-100 ${FOCUS_RING}`} title="닫기 (Esc)">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-col flex-1 min-h-0">
            <TaskApprovalBoard projectPath={projectPath} agents={agents} />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
