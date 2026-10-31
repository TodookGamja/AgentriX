export function nextRelaySessionName(sessionName: string): {
  baseName: string;
  relayCount: number;
  newSessionName: string;
} {
  const relayMatch = sessionName.match(/릴레이\s*(\d+)/);
  const relayCount = relayMatch ? parseInt(relayMatch[1], 10) + 1 : 1;
  const baseName = sessionName.replace(/\s*\(릴레이.*?\)/, "").trim();
  return {
    baseName,
    relayCount,
    newSessionName: `${baseName} (릴레이 ${relayCount})`,
  };
}

/** 분할 슬롯에 있던 이전 세션 ID를 신규 릴레이 세션 ID로 교체 */
export function remapSplitSlotsAfterRelay(
  slots: (string | null)[],
  oldSessionId: string,
  newSessionId: string
): (string | null)[] {
  return slots.map((sid) => (sid === oldSessionId ? newSessionId : sid));
}

// 자동 릴레이 새 세션에는 아무것도 주입하지 않고, 그 세션에 첫 입력(배정·메일·사용자)이 전달될 때 안내 1줄만 앞에 붙인다.
// 같은 방식으로 시스템 지시 미지원 CLI의 역할 지침도 첫 제출형 입력(어느 경로든)에 1회 붙인다. 둘 다 대기 중이면 한 번에 이어 붙인다.
const pendingPrefix = new Map<string, string>();
export const HANDOFF_HINT = "[릴레이] 먼저 .ai-agents/SESSION_HANDOFF.md를 참고하세요. ";
export function markFirstInputPrefix(sessionId: string, text: string): void {
  pendingPrefix.set(sessionId, (pendingPrefix.get(sessionId) ?? "") + text);
}
export function markHandoffHint(sessionId: string): void {
  markFirstInputPrefix(sessionId, HANDOFF_HINT);
}
/** 제출형 입력(2자 이상, \r로 끝남, 슬래시 명령 아님)에만 안내를 1회 붙여 돌려준다. 키 입력·제어 키·/compact는 그대로 통과. */
export function applyHandoffHint(sessionId: string, data: string): string {
  const prefix = pendingPrefix.get(sessionId);
  if (!prefix || data.length < 2 || !data.endsWith("\r") || data.startsWith("/") || data.startsWith("\x1b")) return data;
  pendingPrefix.delete(sessionId);
  return prefix + data;
}

export function handoffContinuePrompt(isManual: boolean): string {
  return isManual
    ? `.ai-agents/SESSION_HANDOFF.md를 읽으세요. 거기 적힌 '직전 세션이 받은 지시' 중 아직 끝나지 않은 것을 지금 이어서 끝까지 수행하세요. 확인·요약만 하고 멈추지 마세요.\r`
    : `.ai-agents/SESSION_HANDOFF.md를 읽고 완료된 이전 작업의 맥락을 파악한 뒤 다음 지시를 기다리세요.\r`;
}
