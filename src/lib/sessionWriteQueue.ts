// 본문을 쓴 뒤 Enter를 보내도 되는지: CLI가 본문을 읽어 화면에 반영(출력)한 뒤여야 한다.
// 본문이 안 읽힌 채 Enter가 뒤따르면 둘이 한 덩어리로 읽혀 붙여넣기 속 줄바꿈으로 삼켜진다.
// 반영 후 100ms 조용하면 바로, 계속 출력 중(작업 중 스피너 등)이면 기존 대기 시간이 지나면 보낸다.
export function enterReady(sentAt: number, lastOutput: number | null, now: number, minWait: number): boolean {
  if (lastOutput === null || lastOutput < sentAt) return now - sentAt >= 3000;
  return now - lastOutput >= 100 || now - sentAt >= minWait;
}

// 길거나 여러 줄인 본문은 bracketed paste(ESC[200~…ESC[201~)로 감싸 붙여넣기 경계를 명시한다.
// codex는 경계 없이 본문 뒤에 온 \r을 입력창 줄바꿈으로 삼킨다. 짧은 한 줄 입력은 지원 안 하는 CLI를 위해 그대로 둔다.
// enabled = 백엔드(get_session_paste_mode)가 알려 준 세션의 마지막 ESC[?2004h/l 상태. 켠 세션에만 감싸고 미수신·끔은 현행(무래핑).
export function pasteWrap(body: string, enabled: boolean): string {
  if (!enabled) return body;
  return body.length >= 200 || body.includes("\n") ? `\x1b[200~${body}\x1b[201~` : body;
}

// Enter 전송 뒤 출력이 전혀 없으면 \r이 삼켜진 것으로 보고 재전송한다.
// codex는 \r을 삼켜도 화면을 다시 그려 출력이 생기므로, Enter 이후 출력에 붙여넣기 칩이 남아 있어도 삼켜진 것으로 본다.
export function submissionStarted(output: string, logStarted: boolean | null): boolean {
  if (logStarted !== null) return logStarted;
  if (output.includes("\x1b]7501;state=working")) return true;
  const text = output.replace(/\x1b\[\d*C/g, " ").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  return /esc to (?:interrupt|cancel)|\bGenerating\.{0,3}|\bWorking \(/i.test(text);
}
export function needsEnterRetry(started: boolean, userChanged: boolean): boolean {
  return !started && !userChanged;
}

const tails =new Map<string, Promise<void>>();

export function queueSessionWrite(sessionId: string, write: () => Promise<void>): Promise<void> {
  const previous = tails.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(write);
  tails.set(sessionId, next);
  void next.finally(() => {
    if (tails.get(sessionId) === next) tails.delete(sessionId);
  }).catch(() => {});
  return next;
}
