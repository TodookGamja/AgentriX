import React, { useEffect, useState } from "react";
import { apiCancelProjectBlackboardTask, apiGetProjectBlackboard } from "../lib/tauriBridge";
import { boardTaskColumn, boardTaskTitle, compareWaiting, parseBoardTasks, shortTaskTitle, type BoardTask } from "../lib/blackboardDispatch";
import { getTeamMailDeliveries, removeTeamMailDelivery } from "../lib/teamMailDelivery";
import { useSessionQueue } from "../lib/sessionQueueStore";
import { useAppStore } from "../lib/store";
import {
  getApprovalMode,
  getApprovals,
  getDispatchNotes,
  setApprovalMode,
  upsertApproval,
  type TaskApproval,
} from "../lib/taskApproval";
import { recentDone } from "../lib/boardDone";
import { alertDialog, confirmDialog } from "../lib/confirmDialog";
import type { ProjectAgentRecord } from "../types/types";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

interface Card {
  taskId: string;
  agentId: string;
  title: string;
  waitReason?: string;
  blockedBy?: string[];
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
  const [cards, setCards] = useState<(Card & { status: BoardTask["status"]; confirmed: boolean; live: boolean; queued: boolean; waitReason: string })[]>([]);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showAllDone, setShowAllDone] = useState(false);
  const [tick, setTick] = useState(0); // 취소 직후 3초 폴링을 기다리지 않고 다시 읽기

  useEffect(() => {
    setMode(getApprovalMode(projectPath));
    let stopped = false;
    const refresh = async () => {
      setApprovals(getApprovals(projectPath));
      setNotes(getDispatchNotes(projectPath));
      try {
        const board = await apiGetProjectBlackboard(projectPath);
        const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));
        const tasks = parseBoardTasks(board, agents.map((a) => a.id), names, true);
        const deliveries = getTeamMailDeliveries().filter((d) => d.project === projectPath);
        const { queues, handled } = useSessionQueue.getState();
        const sessions = useAppStore.getState().sessions;
        const sent: string[] = JSON.parse(localStorage.getItem(`agentrix_bb_dispatched:${projectPath}`) || "[]");
        // 같은 작업이 착수→완료로 두 번 나오면 마지막 상태만 사용
        const last = new Map(tasks.map((t) => [`${t.taskId}:${t.agentId}`, t]));
        if (!stopped) {
          setCards([...last.values()].map((t) => {
            const queue = queues[t.agentId]?.find((item) => item.id === `assign:${t.taskId}`);
            const delivery = deliveries.find((d) => d.agentId === t.agentId && d.kind === "task" && d.id === t.taskId);
            const live = sessions.some((s) => s.cwd === projectPath && s.agentId === t.agentId && s.status === "running");
            const confirmed = !handled.includes(`${t.agentId}|assign:${t.taskId}`) && (Boolean(delivery && !delivery.unconfirmed) || sent.includes(`${t.taskId}:start:${t.agentId}`));
            const waitReason = t.status === "invalid" ? "상태 형식 오류: 상태 칸은 ⏳/🔥/✅/통합/취소로 시작해야 합니다" : t.blockedBy?.length ? `선행 ${t.blockedBy.map((id) => id.replace(/^.*_(?=\d+$)/, "_")).join(", ")} 대기` : t.status === "wait" ? "작업표에서 대기 중" : queue?.reason || (!live ? "담당 세션이 없습니다" : delivery?.unconfirmed ? "전달 결과 미확인" : "전달 대기");
            return { ...t, title: boardTaskTitle(board, t.taskId), confirmed, live, queued: Boolean(queue), waitReason };
          }));
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
  }, [projectPath, agents, tick]);

  const nameOf = (agentId: string) => agents.find((a) => a.id === agentId)?.name ?? agentId;
  const statusOf = (c: Card) => approvals.find((a) => a.taskId === c.taskId && a.agentId === c.agentId)?.status;
  const decide = (c: Card, status: "approved" | "rejected", why?: string) => {
    upsertApproval(projectPath, { taskId: c.taskId, agentId: c.agentId, status, reason: why });
    setApprovals(getApprovals(projectPath));
    setRejecting(null);
    setReason("");
  };

  // 작업표의 해당 행 상태 칸만 "취소"로 바꾸고 그 작업의 전달 대기·예약을 정리(완료 칸으로 이동, 재전달 없음)
  const cancel = async (c: Card) => {
    if (!(await confirmDialog({ title: `${c.taskId} 작업을 취소할까요?`, message: "작업표 상태가 '취소'로 바뀌고 전달 대기가 정리됩니다.", confirmLabel: "작업 취소", cancelLabel: "닫기", danger: true }))) return;
    try {
      await apiCancelProjectBlackboardTask(projectPath, c.taskId);
      useSessionQueue.getState().remove(c.agentId, `assign:${c.taskId}`);
      removeTeamMailDelivery(projectPath, c.agentId, c.taskId, "task");
    } catch (e) {
      await alertDialog("취소하지 못했습니다", String(e));
    }
    setTick((v) => v + 1);
  };
  const cancelButton = (c: Card) => (
    <button onClick={() => void cancel(c)} className={`px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-semibold ${FOCUS}`}>
      취소
    </button>
  );

  const manual = mode === "manual";
  const kindOf = (c: typeof cards[number]) => boardTaskColumn({ ...c, blocked: Boolean(c.blockedBy?.length), manual, approval: statusOf(c) });
  const pending = cards.filter((c) => kindOf(c) === "approval");
  const waiting = cards.filter((c) => kindOf(c) === "waiting").sort(compareWaiting);
  const rejected = cards.filter((c) => kindOf(c) === "rejected");
  const running = cards.filter((c) => kindOf(c) === "running");
  const doneAll = cards.filter((c) => kindOf(c) === "done");
  const { shown: done, hidden: hiddenDone } = recentDone(doneAll, showAllDone);

  const column = (title: string, tone: string, items: Card[], actions?: (c: Card) => React.ReactNode, total = items.length, footer?: React.ReactNode) => (
    <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-2 min-h-[8rem] min-h-0 overflow-y-auto">
      <div className={`text-xs font-bold ${tone}`}>
        {title} ({total})
      </div>
      {items.length === 0 && <div className="py-6 text-center border border-dashed border-slate-800/80 rounded-lg text-slate-400 text-[11px]">없음</div>}
      {items.map((c) => (
        <div key={`${c.taskId}:${c.agentId}`} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
          <div className="text-xs font-semibold text-slate-100 truncate" title={c.title || c.taskId}>
            {shortTaskTitle(c.title) || c.taskId}
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            <span className="font-mono">{c.taskId}</span> · {nameOf(c.agentId)}
          </div>
          {c.title && c.title !== shortTaskTitle(c.title) && (
            <details className="text-[11px] text-slate-400">
              <summary className={`cursor-pointer text-slate-400 hover:text-slate-200 ${FOCUS}`}>전체 설명</summary>
              <div className="mt-1 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{c.title}</div>
            </details>
          )}
          {tone.includes("sky") && notes[c.taskId] && (
            <div className={`text-[11px] break-all line-clamp-2 ${notes[c.taskId].startsWith("전달됨") || Number(notes[c.taskId].match(/(\d+)분째/)?.[1] ?? 99999) < 30 ? "text-sky-300/80" : "text-amber-300/80"}`}>
              {notes[c.taskId]}
            </div>
          )}
          {tone.includes("indigo") && (
            <div className="text-[11px] break-all line-clamp-2 text-indigo-300/80">
              {notes[c.taskId]?.startsWith("대기:") ? notes[c.taskId] : c.waitReason}
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

      <div className="grid grid-cols-1 md:grid-cols-5 md:grid-rows-[minmax(0,1fr)] gap-3 flex-1 min-h-0">
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
        {column("대기", "text-indigo-300", waiting, cancelButton)}
        {column("진행 중", "text-sky-300", running, cancelButton)}
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
