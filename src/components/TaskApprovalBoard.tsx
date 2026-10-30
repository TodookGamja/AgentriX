import React, { useEffect, useState } from "react";
import { apiGetProjectBlackboard } from "../lib/tauriBridge";
import { boardTaskTitle, parseBoardTasks } from "../lib/blackboardDispatch";
import {
  getApprovalMode,
  getApprovals,
  getDispatchNotes,
  setApprovalMode,
  upsertApproval,
  type TaskApproval,
} from "../lib/taskApproval";
import { recentDone } from "../lib/boardDone";
import type { ProjectAgentRecord } from "../types/types";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

interface Card {
  taskId: string;
  agentId: string;
  title: string;
}

interface TaskApprovalBoardProps {
  projectPath: string;
  agents: ProjectAgentRecord[];
}

// PM 작업표의 작업을 승인 대기 / 진행 / 완료 / 반려 열로 보여주고, 수동 승인 모드에서 승인·반려를 처리
export const TaskApprovalBoard: React.FC<TaskApprovalBoardProps> = ({ projectPath, agents }) => {
  const [mode, setMode] = useState(() => getApprovalMode(projectPath));
  const [approvals, setApprovals] = useState<TaskApproval[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [cards, setCards] = useState<(Card & { status: "start" | "done" })[]>([]);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showAllDone, setShowAllDone] = useState(false);

  useEffect(() => {
    setMode(getApprovalMode(projectPath));
    let stopped = false;
    const refresh = async () => {
      setApprovals(getApprovals(projectPath));
      setNotes(getDispatchNotes(projectPath));
      try {
        const board = await apiGetProjectBlackboard(projectPath);
        const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));
        const tasks = parseBoardTasks(board, agents.map((a) => a.id), names);
        // 같은 작업이 착수→완료로 두 번 나오면 마지막 상태만 사용
        const last = new Map(tasks.map((t) => [`${t.taskId}:${t.agentId}`, t]));
        if (!stopped) {
          setCards([...last.values()].map((t) => ({ ...t, title: boardTaskTitle(board, t.taskId) })));
        }
      } catch {
        /* 작업표가 아직 없으면 빈 보드 */
      }
    };
    refresh();
    const id = window.setInterval(refresh, 3000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [projectPath, agents]);

  const nameOf = (agentId: string) => agents.find((a) => a.id === agentId)?.name ?? agentId;
  const statusOf = (c: Card) => approvals.find((a) => a.taskId === c.taskId && a.agentId === c.agentId)?.status;
  const decide = (c: Card, status: "approved" | "rejected", why?: string) => {
    upsertApproval(projectPath, { taskId: c.taskId, agentId: c.agentId, status, reason: why });
    setApprovals(getApprovals(projectPath));
    setRejecting(null);
    setReason("");
  };

  const manual = mode === "manual";
  const pending = cards.filter((c) => c.status === "start" && manual && (!statusOf(c) || statusOf(c) === "pending"));
  const rejected = cards.filter((c) => c.status === "start" && statusOf(c) === "rejected");
  const running = cards.filter(
    (c) => c.status === "start" && !pending.includes(c) && !rejected.includes(c)
  );
  const doneAll = cards.filter((c) => c.status === "done");
  const { shown: done, hidden: hiddenDone } = recentDone(doneAll, showAllDone);

  const column = (title: string, tone: string, items: Card[], actions?: (c: Card) => React.ReactNode, total = items.length, footer?: React.ReactNode) => (
    <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-2 min-h-[8rem] min-h-0 overflow-y-auto">
      <div className={`text-xs font-bold ${tone}`}>
        {title} ({total})
      </div>
      {items.length === 0 && <div className="py-6 text-center border border-dashed border-slate-800/80 rounded-lg text-slate-500 text-[11px]">없음</div>}
      {items.map((c) => (
        <div key={`${c.taskId}:${c.agentId}`} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
          <div className="text-xs text-slate-200">
            <span className="font-mono text-indigo-300">{c.taskId}</span> · {nameOf(c.agentId)}
          </div>
          {c.title && <div className="text-[11px] text-slate-400 line-clamp-2">{c.title}</div>}
          {tone.includes("sky") && notes[c.taskId] && (
            <div className={`text-[11px] break-all line-clamp-2 ${notes[c.taskId].startsWith("전달됨") ? "text-sky-300/80" : "text-amber-300/80"}`}>
              {notes[c.taskId]}
            </div>
          )}
          {tone.includes("rose") && (
            <div className="text-[11px] text-rose-300/80">
              사유: {approvals.find((a) => a.taskId === c.taskId && a.agentId === c.agentId)?.reason || "없음"}
            </div>
          )}
          {actions?.(c)}
        </div>
      ))}
      {footer}
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800 shrink-0">
        <div className="text-xs text-slate-400">
          {manual
            ? "수동 승인: PM이 작업표에 올린 작업은 승인해야 팀원에게 전달됩니다."
            : "자동: PM이 작업표에 올린 작업이 바로 팀원에게 전달됩니다."}
        </div>
        <button
          onClick={() => {
            const next = manual ? "auto" : "manual";
            setApprovalMode(projectPath, next);
            setMode(next);
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${FOCUS} ${
            manual
              ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
              : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
          }`}
        >
          {manual ? "수동 승인 ON" : "수동 승인 OFF"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-[minmax(0,1fr)] gap-3 flex-1 min-h-0">
        {column("승인 대기", "text-amber-300", pending, (c) =>
          rejecting === `${c.taskId}:${c.agentId}` ? (
            <div className="space-y-1.5">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="반려 사유 (PM에게 전달)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") decide(c, "rejected", reason.trim());
                  else if (e.key === "Escape") setRejecting(null);
                }}
                autoFocus
                className={`w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-[11px] text-slate-100 ${FOCUS}`}
              />
              <div className="text-[10px] text-slate-500">(Enter 확정, Esc 취소)</div>
              <div className="flex gap-1.5">
                <button onClick={() => decide(c, "rejected", reason.trim())} className={`px-2 py-1 rounded bg-rose-600 text-white text-[11px] font-semibold ${FOCUS}`}>
                  반려 확정
                </button>
                <button onClick={() => setRejecting(null)} className={`px-2 py-1 rounded bg-slate-800 text-slate-300 text-[11px] ${FOCUS}`}>
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <button onClick={() => decide(c, "approved")} className={`px-2 py-1 rounded bg-emerald-600 text-white text-[11px] font-semibold ${FOCUS}`}>
                승인
              </button>
              <button onClick={() => setRejecting(`${c.taskId}:${c.agentId}`)} className={`px-2 py-1 rounded bg-slate-800 text-rose-300 border border-slate-700 text-[11px] font-semibold ${FOCUS}`}>
                반려
              </button>
            </div>
          )
        )}
        {column("진행 중", "text-sky-300", running)}
        {column("완료", "text-emerald-300", done, undefined, doneAll.length, (hiddenDone > 0 || showAllDone) && doneAll.length > 5 ? (
          <button onClick={() => setShowAllDone((v) => !v)} className={`w-full px-2 py-1 rounded bg-slate-800 text-slate-300 text-[11px] ${FOCUS}`}>
            {showAllDone ? "접기" : `이전 완료 ${hiddenDone}개 보기`}
          </button>
        ) : null)}
        {column("반려", "text-rose-300", rejected)}
      </div>
    </div>
  );
};
