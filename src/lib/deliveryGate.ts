// 팀 전달 뒤 "턴이 실제로 시작됐는가" 판정. 배정문의 Enter가 입력창 줄바꿈으로 삼켜지면 제출되지 않았는데도
// lastSubmission이 갱신되고 출력도 멈춰 '턴 종료'로 오인 → 다음 배정이 같은 입력창에 쌓인다.
// 시작 증거 = (a) CLI 로그가 전달 이후 완료한 턴(evidence) 또는 (b) 전달(재전송이면 재전송) 1.5초 뒤에도 출력이 있었음.
// 붙여넣기·Enter 에코는 직후 1.5초 안에 끝나므로 그 뒤 출력은 CLI가 일을 시작한 것으로 본다. 로그를 못 읽는 CLI도 (b)로 판정한다.
// 증거 없이 Enter 1회 재전송 뒤에도 15초가 지나면 다음 본문은 보류하고 '멈춤'.
export interface PendingDelivery {
  at: number; // 전달 직후 lastSubmission
  retriedAt?: number;
  started?: boolean; // 에코 이후 출력을 본 적 있음
}
export type GateAction = "proceed" | "resend" | "wait" | "stuck";
export const STUCK_AFTER_MS = 15_000;
export const ECHO_WINDOW_MS = 1_500;

// quiet = apiGetSessionQuietSince: null이면 출력이 10초 안에 있는 작업 중, 숫자면 출력이 멈춘 시각(= 마지막 출력 시각).
export function deliveryGate(p: PendingDelivery | undefined, evidence: boolean, quiet: number | null, now: number): GateAction {
  if (!p || evidence) return "proceed";
  const since = (p.retriedAt ?? p.at) + ECHO_WINDOW_MS;
  if (quiet === null ? now > since : quiet > since) p.started = true;
  if (quiet === null) return "wait"; // 작업 중: 재전송·멈춤 표시 없이 대기
  if (p.started) return "proceed";
  if (p.retriedAt === undefined) return "resend"; // Enter만 1회 재전송하고 대기
  return now - p.retriedAt > STUCK_AFTER_MS ? "stuck" : "wait";
}
