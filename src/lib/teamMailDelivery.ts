export interface TeamMailDelivery {
  id: string;
  agentId: string;
  project: string;
  sessionId: string;
  submittedAt: number;
  unconfirmed?: boolean;
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

export function reserveTeamMailDelivery(delivery: TeamMailDelivery): boolean {
  const existing = getTeamMailDeliveries();
  if (existing.some((d) => d.project === delivery.project && d.agentId === delivery.agentId)) return false;
  localStorage.setItem(key, JSON.stringify([...existing, delivery]));
  return true;
}

export function removeTeamMailDelivery(project: string, agentId: string, id: string, kind?: "task" | "report" | "goal"): void {
  localStorage.setItem(key, JSON.stringify(getTeamMailDeliveries().filter((d) => !(d.project === project && d.agentId === agentId && d.id === id && d.kind === kind))));
}

export function pruneStaleMailDeliveries(project: string, liveSessionIds: string[]): void {
  const all = getTeamMailDeliveries();
  const keep = all.filter((d) => d.project !== project || d.kind !== undefined || d.unconfirmed || liveSessionIds.includes(d.sessionId));
  if (keep.length !== all.length) localStorage.setItem(key, JSON.stringify(keep));
}

// 받은 세션이 이미 사라진 task/report 기록 제거 (goal은 세션 없이 보관되므로 제외). 제거한 기록 수 반환
export function pruneStaleDeliveries(project: string, liveSessionIds: string[]): number {
  const all = getTeamMailDeliveries();
  const keep = all.filter((d) => d.project !== project || d.kind === "goal" || d.unconfirmed || liveSessionIds.includes(d.sessionId));
  if (keep.length !== all.length) localStorage.setItem(key, JSON.stringify(keep));
  return all.length - keep.length;
}

// 전달 2분 뒤에도 그 뒤로 출력이 전혀 없으면(quiet 시각이 전달 시각 이전) 입력이 먹히지 않은 것으로 보고 재전달, 최대 3회
export function shouldRedeliver(waitMin: number, quietSince: number | null, submittedAt: number, retries: number): boolean {
  return waitMin >= 2 && retries < 3 && quietSince !== null && quietSince <= submittedAt;
}

// 예약만 되고(unconfirmed) 대응하는 대기열 항목이 사라진 고아 기록: 같은 팀원의 뒤 항목을 영원히 '앞 전달 대기'로 막는다.
// 전달 중일 수 있으므로 유예 시간이 지난 것만 대상으로 한다. 전달 확정(unconfirmed=false) 기록은 작업 수행 중 증거라 건드리지 않는다.
export function orphanReservation(deliveries: TeamMailDelivery[], project: string, agentId: string, queueIds: ReadonlySet<string>, now: number, graceMs = 30_000): TeamMailDelivery | undefined {
  return deliveries.find((d) => d.project === project && d.agentId === agentId && d.unconfirmed === true && now - d.submittedAt > graceMs
    && !queueIds.has(`${d.kind === "task" ? "assign" : d.kind === "report" ? "report" : "mail"}:${d.id}`));
}
