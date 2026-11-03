export interface CursorTurn {
  startedAt: number;
  completedAt?: number;
  lastFalseAt?: number;
}

export class CursorBusyError extends Error {
  constructor() { super("팀원이 응답 중입니다. 전달을 보류합니다."); this.name = "CursorBusyError"; }
}

export function cursorTurnBusy(lines: string[]): boolean {
  return lines.some((line) => /ctrl\+c\s+to\s+stop/i.test(line));
}

export function cursorTurnFromLines(lines: string[], previous: CursorTurn | undefined, now: number): CursorTurn | undefined {
  if (cursorTurnBusy(lines)) {
    return previous && !previous.completedAt ? { startedAt: previous.startedAt } : { startedAt: now };
  }
  if (!previous || previous.completedAt) return previous;
  if (previous.lastFalseAt === undefined) return { ...previous, lastFalseAt: now };
  return now - previous.lastFalseAt >= 1000 ? { ...previous, completedAt: now } : previous;
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

export function readCursorTurn(id: string): CursorTurn | undefined {
  const lines = readTerminalScreen(id);
  if (!lines) return undefined;
  const next = cursorTurnFromLines(lines, turns.get(id), Date.now());
  if (next) turns.set(id, next);
  return next;
}
