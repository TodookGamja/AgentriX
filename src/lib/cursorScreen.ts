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

export function readTerminalScreen(id: string): string[] | null {
  return screens.get(id)?.() ?? null;
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
  return transcripts.get(id)?.() ?? null;
}
