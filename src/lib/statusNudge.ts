// 턴을 끝내고 유휴인데 작업표 🔥로 남은 작업: 팀원에게 이어서 끝까지 진행하라고 요청하고 작업판에 '쉬는 중'을 표시한다.
// 앱이 상태 칸을 대신 ✅로 바꾸지는 않는다(판정은 팀원·PM).
export const idleStaleKeys = new Set<string>(); // `${agentId}:${taskId}` 작업판 표시용
export const nudgeCounts = new Map<string, number>(); // 같은 키로 보낸 진행 요청 횟수(작업판 카드 표시용)

export type NudgeMem = Record<string, { count: number; armed: boolean; lastAt?: number; pmNotified?: boolean }>;

// 처음 max회는 턴마다 1회(유예 후), 이후 영구 침묵 없이 5분→15분 간격으로 계속 알린다. busy면 모든 키 재무장.
export const NUDGE_BACKOFF_MS = [300_000, 900_000];
export const PM_NOTICE_AFTER = 3;
export function dueNudges(mem: NudgeMem, keys: string[], busy: boolean, idleMs: number, graceMs = 60_000, max = 2, now = Date.now()): string[] {
  if (busy) { for (const k of keys) (mem[k] ??= { count: 0, armed: true }).armed = true; return []; }
  if (idleMs < graceMs) return [];
  return keys.filter((k) => {
    const m = (mem[k] ??= { count: 0, armed: true });
    if (m.count < max) return m.armed;
    return now - (m.lastAt ?? 0) >= NUDGE_BACKOFF_MS[Math.min(m.count - max, NUDGE_BACKOFF_MS.length - 1)];
  });
}

export function markNudged(mem: NudgeMem, key: string, now = Date.now()): void {
  const m = (mem[key] ??= { count: 0, armed: true });
  m.count++; m.armed = false; m.lastAt = now;
  nudgeCounts.set(key, m.count);
}

/** 3회째 요청부터 PM에게도 알릴 키(키당 1회). 호출 측이 보낸 뒤 markPmNotified. */
export function pmNoticeDue(mem: NudgeMem, keys: string[]): string[] {
  return keys.filter((k) => (mem[k]?.count ?? 0) >= PM_NOTICE_AFTER && !mem[k].pmNotified);
}
export function markPmNotified(mem: NudgeMem, key: string): void { (mem[key] ??= { count: 0, armed: true }).pmNotified = true; }

export const nudgeText = (taskIds: string[]) =>
  `[상태 확인] 작업표의 ${taskIds.join(", ")} 행이 아직 🔥 착수입니다. 메모만 바꾸고 멈추지 말고 작업을 이어서 끝까지 진행하세요. 끝나면 상태를 ✅ 완료(결과 한 줄 메모)로 바꾸고, 막혔다면 PM에게 메일로 알리세요.\r`;
