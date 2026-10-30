import { useEffect, useState } from "react";
import { apiAcknowledgeTeamMail, apiRouteTeamMail, type TeamMail } from "../lib/tauriBridge";
import { getTeamMailDeliveries, removeTeamMailDelivery, saveTeamMailDelivery, type TeamMailDelivery } from "../lib/teamMailDelivery";
import type { ProjectAgentRecord, SessionInfo } from "../types/types";

export function TeamMailStatus({ projectPath, agents, sessions }: { projectPath: string; agents: ProjectAgentRecord[]; sessions: SessionInfo[] }) {
  const [messages, setMessages] = useState<TeamMail[]>([]);
  const [deliveries, setDeliveries] = useState<TeamMailDelivery[]>([]);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      setMessages(await apiRouteTeamMail(projectPath));
      setDeliveries(getTeamMailDeliveries().filter((d) => d.project === projectPath));
      setError("");
    } catch (err) { setError(String(err)); }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [projectPath]);

  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const recover = async (message: TeamMail, complete: boolean) => {
    try {
      if (complete) await apiAcknowledgeTeamMail(projectPath, message.to, message.id);
      removeTeamMailDelivery(projectPath, message.to, message.id);
      await refresh();
    } catch (err) { setError(String(err)); }
  };
  const recoverTask = (delivery: TeamMailDelivery, complete: boolean) => {
    try {
      if (delivery.kind === "goal") {
        if (complete) removeTeamMailDelivery(projectPath, delivery.agentId, delivery.id, "goal");
        else saveTeamMailDelivery({ ...delivery, sessionId: "", submittedAt: 0 });
        void refresh();
        return;
      }
      if (complete) {
        const key = `agentrix_bb_dispatched:${projectPath}`;
        const stored: unknown = JSON.parse(localStorage.getItem(key) || "[]");
        if (!Array.isArray(stored) || !stored.every((item) => typeof item === "string")) throw new Error("잘못된 작업 배정 기록");
        const sent = new Set<string>(stored);
        if (delivery.kind === "report") {
          const separator = delivery.id.indexOf(":");
          if (separator < 0) throw new Error("잘못된 완료 보고 ID");
          sent.add(`${delivery.id.slice(0, separator)}:done:${delivery.id.slice(separator + 1)}`);
        } else {
          sent.add(`${delivery.id}:start:${delivery.agentId}`);
        }
        localStorage.setItem(key, JSON.stringify([...sent]));
      }
      removeTeamMailDelivery(projectPath, delivery.agentId, delivery.id, delivery.kind);
      void refresh();
    } catch (err) { setError(String(err)); }
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2" aria-label="팀 메시지 현황">
      <h4 className="text-xs font-bold text-slate-200">팀 메시지 현황 ({messages.length})</h4>
      {error && <p role="alert" className="text-xs text-red-300">메시지함 확인 실패: {error}</p>}
      {!error && messages.length === 0 && <p className="text-xs text-slate-400">대기 중인 메시지가 없습니다.</p>}
      {deliveries.filter((d) => d.kind).map((d) => {
        const active = sessions.some((s) => s.id === d.sessionId);
        const queued = d.kind === "goal" && !d.sessionId;
        return <div key={`task:${d.agentId}:${d.id}`} className="rounded-lg bg-slate-900 p-2 text-xs text-slate-300 space-y-1">
          <div>{name(d.agentId)} · {d.kind === "goal" ? "협업 목표" : d.kind === "report" ? "완료 보고" : "작업"} {d.kind === "goal" ? "" : d.id} · {queued ? "전달 대기" : active ? "처리 중" : "결과 확인 필요"}</div>
          {queued && <div className="flex flex-wrap items-center gap-2"><span className="text-slate-400">{!sessions.some((s) => s.agentId === d.agentId) ? "총괄 세션을 실행하면 전달을 시도합니다." : !["claude", "codex", "opencode"].includes(agents.find((a) => a.id === d.agentId)?.cliId ?? "") ? "이 CLI는 작업 완료 자동 감지를 지원하지 않아 전달이 대기합니다." : "총괄 세션의 작업 완료 상태가 확인되면 전달합니다."}</span><button type="button" onClick={() => recoverTask(d, true)} className="rounded bg-slate-700 px-2 py-1">대기 취소</button></div>}
          {!queued && !active && <div className="flex flex-wrap items-center gap-2">
            <span className="text-amber-300">블랙보드에서 작업 결과를 확인한 후 선택하세요.</span>
            <button type="button" onClick={() => recoverTask(d, false)} className="rounded bg-indigo-700 px-2 py-1">다시 전달</button>
            <button type="button" onClick={() => recoverTask(d, true)} className="rounded bg-slate-700 px-2 py-1">전달 완료 처리</button>
          </div>}
        </div>;
      })}
      {messages.map((m) => {
        const delivery = deliveries.find((d) => !d.kind && d.agentId === m.to && d.id === m.id);
        const active = delivery && sessions.some((s) => s.id === delivery.sessionId);
        const receiver = agents.find((a) => a.id === m.to);
        const unavailable = !sessions.some((s) => s.agentId === m.to);
        const unsupported = receiver && !["claude", "codex", "opencode"].includes(receiver.cliId);
        return <div key={`${m.to}:${m.id}`} className="rounded-lg bg-slate-900 p-2 text-xs text-slate-300 space-y-1">
          <div className="flex flex-wrap justify-between gap-2"><span>{name(m.from)} → {name(m.to)} · {m.subject}</span><span>{delivery ? active ? "처리 중" : "결과 확인 필요" : unavailable ? "세션 실행 필요" : unsupported ? "CLI 완료 감지 미지원" : "전달 대기"}</span></div>
          <p className="whitespace-pre-wrap break-words text-slate-400">{m.body}</p>
          {delivery && !active && <div className="flex flex-wrap items-center gap-2">
            <span className="text-amber-300">이전 세션의 처리 결과를 확인한 후 선택하세요.</span>
            <button type="button" onClick={() => void recover(m, false)} className="rounded bg-indigo-700 px-2 py-1">다시 전달</button>
            <button type="button" onClick={() => void recover(m, true)} className="rounded bg-slate-700 px-2 py-1">완료 처리</button>
          </div>}
        </div>;
      })}
    </section>
  );
}
