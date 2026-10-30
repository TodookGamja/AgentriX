// 본문을 쓴 뒤 Enter를 보내도 되는지: CLI가 본문을 읽어 화면에 반영(출력)한 뒤여야 한다.
// 본문이 안 읽힌 채 Enter가 뒤따르면 둘이 한 덩어리로 읽혀 붙여넣기 속 줄바꿈으로 삼켜진다.
// 반영 후 100ms 조용하면 바로, 계속 출력 중(작업 중 스피너 등)이면 기존 대기 시간이 지나면 보낸다.
export function enterReady(sentAt: number, lastOutput: number | null, now: number, minWait: number): boolean {
  if (lastOutput === null || lastOutput < sentAt) return now - sentAt >= 3000;
  return now - lastOutput >= 100 || now - sentAt >= minWait;
}

const tails = new Map<string, Promise<void>>();

export function queueSessionWrite(sessionId: string, write: () => Promise<void>): Promise<void> {
  const previous = tails.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(write);
  tails.set(sessionId, next);
  void next.finally(() => {
    if (tails.get(sessionId) === next) tails.delete(sessionId);
  }).catch(() => {});
  return next;
}
