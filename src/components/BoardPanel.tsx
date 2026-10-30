import { useEffect, useRef, useState } from "react";
import { ClipboardList, X } from "lucide-react";
import { TaskApprovalBoard } from "./TaskApprovalBoard";
import { panelMaxHeight } from "../lib/boardDone";
import type { ProjectAgentRecord } from "../types/types";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// 작업보드 상시 보기: 프로젝트 화면과 같은 칸반(승인 대기/진행 중/완료/반려)을 헤더 팝업으로 띄운다
export function BoardPanel({ projectPath, agents }: { projectPath: string; agents: ProjectAgentRecord[] }) {
  const [open, setOpen] = useState(false);
  const [maxH, setMaxH] = useState(600);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    // 패널 아래 끝이 창 밖으로 잘리지 않도록 버튼 하단 기준으로 높이 제한
    const fit = () => boxRef.current && setMaxH(panelMaxHeight(window.innerHeight, boxRef.current.getBoundingClientRect().bottom));
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
    <div ref={boxRef} className="relative shrink-0">
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
      {open && (
        <div style={{ maxHeight: maxH }} className="absolute right-0 top-full mt-2 z-50 w-[min(1400px,95vw)] flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-3 text-xs text-slate-200">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="font-bold">작업보드 (3초마다 갱신)</span>
            <button onClick={() => setOpen(false)} className={`p-0.5 rounded text-slate-400 hover:text-slate-100 ${FOCUS_RING}`} title="닫기 (Esc)">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-col flex-1 min-h-0">
            <TaskApprovalBoard projectPath={projectPath} agents={agents} />
          </div>
        </div>
      )}
    </div>
  );
}
