// 턴을 끝내고 유휴인데 작업표 행이 🔥로 남은 작업: 팀원에게 상태 갱신을 요청하고 작업판에 '쉬는 중'을 표시한다.
// 앱이 상태 칸을 대신 ✅로 바꾸지는 않는다(판정은 팀원·PM).
export const idleStaleKeys = new Set<string>(); // `${agentId}:${taskId}` — 작업판 표시용

export type NudgeMem = Record<string, { count: number; armed: boolean }>;

// busy면 모든 키를 재무장(다음 유휴 때 재알림 가능), 유예 시간 이상 유휴일 때만 무장된 키를 반환. 키당 최대 max회.
export function dueNudges(mem: NudgeMem, keys: string[], busy: boolean, idleMs: number, graceMs = 60_000, max = 2): string[] {
  if (busy) { for (const k of keys) (mem[k] ??= { count: 0, armed: true }).armed = true; return []; }
  if (idleMs < graceMs) return [];
  return keys.filter((k) => { const m = (mem[k] ??= { count: 0, armed: true }); return m.armed && m.count < max; });
}

export function markNudged(mem: NudgeMem, key: string): void {
  const m = (mem[key] ??= { count: 0, armed: true });
  m.count++; m.armed = false;
}

export const nudgeText = (taskIds: string[]) =>
  `[상태 확인] 작업표의 ${taskIds.join(", ")} 행이 아직 🔥 착수입니다. 끝났다면 상태를 ✅ 완료(결과 한 줄 메모)로, 진행 중이면 🔥 진행 메모로 갱신하세요.\r`;
