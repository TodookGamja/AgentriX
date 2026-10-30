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

export function handoffContinuePrompt(isManual: boolean): string {
  return isManual
    ? `.ai-agents/SESSION_HANDOFF.md를 읽으세요. 거기 적힌 '직전 세션이 받은 지시' 중 아직 끝나지 않은 것을 지금 이어서 끝까지 수행하세요. 확인·요약만 하고 멈추지 마세요.\r`
    : `.ai-agents/SESSION_HANDOFF.md를 읽고 완료된 이전 작업의 맥락을 파악한 뒤 다음 지시를 기다리세요.\r`;
}
