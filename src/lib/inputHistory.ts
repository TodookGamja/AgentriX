// 세션에 입력된 지시(Enter로 제출된 줄)를 기록한다. 세션 릴레이 시 인수인계 파일에 넣어 새 세션이 지시를 이어받게 함.
// 사용자 키 입력(한 글자씩)과 프로그램 주입(텍스트+\r)이 모두 apiWriteToSession을 거치므로 거기서 호출된다.
// 이력은 세션이 아니라 "프로젝트 폴더+에이전트" 키로 localStorage에 저장 → 릴레이·앱 재시작 후에도 같은 에이전트가 이어받음.
const lineBufs = new Map<string, string>();
const lastKeyAt = new Map<string, number>();
// 키 입력으로 추정한 버퍼라 TUI 입력창과 어긋날 수 있음(Ctrl+W·Alt+Backspace·한글 조합·자동완성 등)
// → 마지막 키 입력 후 30초가 지나면 '입력 중'으로 보지 않는다 (안 그러면 빈 입력창인데도 팀 전달이 영영 막힘)
export const PENDING_INPUT_TTL_MS = 30_000;
export function hasPendingSessionInput(sessionId: string, now = Date.now()): boolean {
  return Boolean(lineBufs.get(sessionId)?.trim()) && now - (lastKeyAt.get(sessionId) ?? 0) < PENDING_INPUT_TTL_MS;
}
const lastSubmission = new Map<string, number>();
const submissionVersion = new Map<string, number>();

export function getLastSubmission(sessionId: string): number {
  return lastSubmission.get(sessionId) ?? 0;
}

export function getSubmissionVersion(sessionId: string): number {
  return submissionVersion.get(sessionId) ?? 0;
}
const memStore = new Map<string, string[]>(); // localStorage 없는 환경(node 검사)용

let keyOf = (sessionId: string) => sessionId;
export function setInstructionKeyResolver(fn: (sessionId: string) => string): void {
  keyOf = fn;
}

const storageKey = (sessionId: string) => `agentrix_instructions:${keyOf(sessionId)}`;

export function getSessionInputHistory(sessionId: string): string[] {
  const k = storageKey(sessionId);
  if (typeof localStorage === "undefined") return memStore.get(k) ?? [];
  try {
    return JSON.parse(localStorage.getItem(k) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(sessionId: string, hist: string[]): void {
  const k = storageKey(sessionId);
  if (typeof localStorage === "undefined") memStore.set(k, hist);
  else localStorage.setItem(k, JSON.stringify(hist));
}

export function recordSessionInput(sessionId: string, data: string): void {
  if (/[\r\n]/.test(data)) {
    lastSubmission.set(sessionId, Date.now());
    submissionVersion.set(sessionId, getSubmissionVersion(sessionId) + 1);
  }
  lastKeyAt.set(sessionId, Date.now());
  let buf = lineBufs.get(sessionId) ?? "";
  // 단독 Esc·Ctrl+C·Ctrl+U는 TUI가 입력창을 비우는 키 → 버퍼도 비운다 (안 비우면 '입력창에 글이 남음'으로 오판해 팀 전달이 영영 막힘)
  if (data === "\x1b" || data === "\x03" || data === "\x15") {
    lineBufs.set(sessionId, "");
    return;
  }
  // 방향키·붙여넣기 마커 등 제어 시퀀스는 버림
  for (const ch of data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b./g, "")) {
    if (ch === "\r") {
      const line = buf.trim();
      buf = "";
      // 한 글자 응답(y/1 등)과 슬래시 명령(/compact 등)은 지시가 아니므로 제외
      if (line.length < 2 || line.startsWith("/")) continue;
      // ponytail: 최근 20개만 보관, 더 긴 작업 이력이 필요하면 BLACKBOARD 기록에 의존
      saveHistory(sessionId, [...getSessionInputHistory(sessionId), line.slice(0, 2000)].slice(-20));
    } else if (ch === "\x7f" || ch === "\b") {
      buf = buf.slice(0, -1);
    } else if (ch >= " " || ch === "\n") {
      buf += ch;
    }
  }
  lineBufs.set(sessionId, buf);
}

export function forgetSessionInput(sessionId: string): void {
  lastSubmission.delete(sessionId);
  submissionVersion.delete(sessionId);
  lastKeyAt.delete(sessionId);
  lineBufs.delete(sessionId); // 이력 자체는 에이전트 키로 남겨 다음 세션이 이어받는다
}
