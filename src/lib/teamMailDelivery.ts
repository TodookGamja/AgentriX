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
