export interface TeamMailDelivery {
  id: string;
  agentId: string;
  project: string;
  sessionId: string;
  submittedAt: number;
  kind?: "task" | "report" | "goal";
  payload?: string;
}

const key = "agentrix_team_mail_deliveries";

export function getTeamMailDeliveries(): TeamMailDelivery[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(value) || !value.every((v) => v && typeof v.id === "string" && typeof v.agentId === "string" && typeof v.project === "string" && typeof v.sessionId === "string" && typeof v.submittedAt === "number" && (v.kind === undefined || v.kind === "task" || v.kind === "report" || (v.kind === "goal" && typeof v.payload === "string")))) throw new Error("Invalid delivery record");
    return value as TeamMailDelivery[];
  } catch { throw new Error("협업 전달 기록을 읽을 수 없습니다. 기록을 보존하고 자동 전달을 중단했습니다."); }
}

export function saveTeamMailDelivery(delivery: TeamMailDelivery): void {
  const remaining = getTeamMailDeliveries().filter((d) => !(d.project === delivery.project && d.agentId === delivery.agentId && d.id === delivery.id && d.kind === delivery.kind));
  localStorage.setItem(key, JSON.stringify([...remaining, delivery]));
}

export function removeTeamMailDelivery(project: string, agentId: string, id: string, kind?: "task" | "report" | "goal"): void {
  localStorage.setItem(key, JSON.stringify(getTeamMailDeliveries().filter((d) => !(d.project === project && d.agentId === agentId && d.id === id && d.kind === kind))));
}

export function pruneStaleMailDeliveries(project: string, liveSessionIds: string[]): void {
  const all = getTeamMailDeliveries();
  const keep = all.filter((d) => d.project !== project || d.kind !== undefined || liveSessionIds.includes(d.sessionId));
  if (keep.length !== all.length) localStorage.setItem(key, JSON.stringify(keep));
}

// 받은 세션이 이미 사라진 task/report 기록 제거 (goal은 세션 없이 보관되므로 제외). 제거한 기록 수 반환
export function pruneStaleDeliveries(project: string, liveSessionIds: string[]): number {
  const all = getTeamMailDeliveries();
  const keep = all.filter((d) => d.project !== project || d.kind === "goal" || liveSessionIds.includes(d.sessionId));
  if (keep.length !== all.length) localStorage.setItem(key, JSON.stringify(keep));
  return all.length - keep.length;
}

// 전달 2분 뒤에도 그 뒤로 출력이 전혀 없으면(quiet 시각이 전달 시각 이전) 입력이 먹히지 않은 것으로 보고 재전달, 최대 3회
export function shouldRedeliver(waitMin: number, quietSince: number | null, submittedAt: number, retries: number): boolean {
  return waitMin >= 2 && retries < 3 && quietSince !== null && quietSince <= submittedAt;
}
