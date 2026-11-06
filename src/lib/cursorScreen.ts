export interface CursorTurn {
  startedAt: number;
  completedAt?: number;
  lastFalseAt?: number;
}

export class CursorBusyError extends Error {
  constructor() { super("팀원이 응답 중입니다. 전달을 보류합니다."); this.name = "CursorBusyError"; }
}

export function cursorTurnBusy(lines: string[]): boolean {
  const bottom = lines.slice(-5);
  return bottom.some((line) => /ctrl\+c\s+to\s+stop|\brunning\b/i.test(line)) ||
    (bottom.some((line) => /\b(?:approval|run this command)\b/i.test(line)) &&
      bottom.some((line) => /\ballow\b/i.test(line)));
}

export function cursorTurnFromLines(lines: string[], previous: CursorTurn | undefined, now: number, quietSince?: number | null, output = false): CursorTurn {
  if (cursorTurnBusy(lines)) {
    return previous && !previous.completedAt ? { startedAt: previous.startedAt } : { startedAt: now };
  }
  if (!previous || (previous.completedAt && output)) return { startedAt: now, lastFalseAt: now };
  if (previous.completedAt) return previous;
  if (previous.lastFalseAt === undefined) return { ...previous, lastFalseAt: now };
  return now - previous.lastFalseAt >= 5000 && quietSince != null && now - quietSince >= 3000
    ? { ...previous, completedAt: now } : previous;
}

export function cursorPastedSubmission(lines: string[], before: string[]): boolean {
  const count = (items: string[]) => items.filter((line) => /\[Pasted text #\d+[^\]]*\]/i.test(line)).length;
  const prompt = [...lines].reverse().find((line) => /^\s*→/.test(line));
  return count(lines) > count(before) && !!prompt && /^\s*→\s*$/.test(prompt);
}

export function codexPastePending(lines: string[]): boolean {
  let prompt = lines.length - 1;
  while (prompt >= 0 && !/^\s*[›❯>]\s*/.test(lines[prompt])) prompt--;
  return prompt >= 0 && /\[Pasted Content[^\]]*\]/i.test(lines.slice(prompt).join("\n"));
}

const screens = new Map<string, () => string[]>();
const turns = new Map<string, CursorTurn>();

export function registerTerminalScreen(id: string, read: () => string[]): () => void {
  screens.set(id, read);
  return () => { if (screens.get(id) === read) screens.delete(id); };
}

// 백엔드 가상 화면(get_session_screen) 사본: 탭 표시·xterm 마운트·창 크기와 무관한 판정 근거. 등록된 reader가 있으면(테스트) 그쪽 우선.
const mirrored = new Map<string, string[]>();

export function setTerminalScreen(id: string, lines: string[]): void {
  mirrored.set(id, lines);
}

export function forgetTerminalScreen(id: string): void {
  mirrored.delete(id);
}

export function readTerminalScreen(id: string): string[] | null {
  const read = screens.get(id);
  if (read) return read();
  const lines = mirrored.get(id);
  return lines ? lines.slice(-10) : null;
}

export function readCursorTurn(id: string, quietSince?: number | null, output = false): CursorTurn | undefined {
  const lines = readTerminalScreen(id);
  if (!lines) return undefined;
  const next = cursorTurnFromLines(lines, turns.get(id), Date.now(), quietSince, output);
  if (next) turns.set(id, next);
  return next;
}

// 전달 확정용 화면 기록(메모리 전용, 저장·전송 안 함): 모든 CLI 터미널의 최근 줄(줄바꿈으로 이어진 줄은 한 줄로 합침)
const transcripts = new Map<string, () => string[]>();

export function registerTerminalTranscript(id: string, read: () => string[]): () => void {
  transcripts.set(id, read);
  return () => { if (transcripts.get(id) === read) transcripts.delete(id); };
}

export function readTerminalTranscript(id: string): string[] | null {
  return transcripts.get(id)?.() ?? mirrored.get(id) ?? null;
}

// 입력창이 아닌 메뉴 화면(슬래시 메뉴·설정·hooks·모델 선택·권한 확인): 하단에 닫기/뒤로/선택 안내가 있다. 이 화면에 쓰면 입력이 메뉴로 들어간다.
// 'esc to interrupt'(작업 중)는 메뉴가 아니므로 포함하지 않는다.
const MENU_FOOTER = /\besc(?:ape)?\b[^\n]{0,12}\b(?:back|cancel|close|exit)\b|\benter\b[^\n]{0,12}\b(?:select|confirm)\b|[↑↓]\s*\/?\s*[↑↓]?\s*(?:to\s+)?(?:select|navigate)/i;
export function menuScreen(lines: string[] | null | undefined): boolean {
  const bottom = (lines ?? []).filter((l) => l.trim()).slice(-4);
  return bottom.some((l) => MENU_FOOTER.test(l));
}
export const MENU_BLOCK_REASON = "팀원 화면이 메뉴에 있음";
export const MENU_ESC_RECOVER_MS = 120_000;
