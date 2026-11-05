// 팀 전달 뒤 "턴이 실제로 시작됐는가" 판정. 배정문의 Enter가 입력창 줄바꿈으로 삼켜지면 제출되지 않았는데도
// lastSubmission이 갱신되고 출력도 멈춰 '턴 종료'로 오인 → 다음 배정이 같은 입력창에 쌓인다.
// 시작 증거 = (a) CLI 로그가 전달 이후 완료한 턴(evidence) 또는 (b) 전달(재전송이면 재전송) 1.5초 뒤에도 출력이 있었음.
// 붙여넣기·Enter 에코는 직후 1.5초 안에 끝나므로 그 뒤 출력은 CLI가 일을 시작한 것으로 본다. 로그를 못 읽는 CLI도 (b)로 판정한다.
// 증거 없이 Enter 1회 재전송 뒤에도 15초가 지나면 다음 본문은 보류하고 '멈춤'.
export interface PendingDelivery {
  at: number; // 전달 직후 lastSubmission
  retriedAt?: number;
  started?: boolean; // 에코 이후 출력을 본 적 있음
  unconfirmed?: boolean;
}
export type GateAction = "proceed" | "resend" | "wait" | "stuck";

// 탭 "응답 중" 표시: 지속된 출력이거나, 열린 로그 턴(마지막 출력이 STALE 안일 때만 — 중단·고아 턴이 영영 깜빡이지 않게).
export const TAB_STALE_TURN_MS = 120_000;
export function tabIsActive(quietSince: number | null, ctx: { startedAt?: number | null; completedAt?: number | null } | undefined, now = Date.now()): boolean {
  if (quietSince === null) return true;
  return Boolean(ctx?.startedAt && ctx.startedAt > (ctx.completedAt ?? 0)) && now - quietSince < TAB_STALE_TURN_MS;
}

export function logTurnStillBusy(cliId: string, ctx: { startedAt?: number | null; completedAt?: number | null } | null): boolean {
  if (!ctx) return false;
  if (ctx.startedAt && !ctx.completedAt) return true;
  return cliId === "codex" && !ctx.startedAt && !ctx.completedAt;
}

export function claudeIdleFallback(cliId: string, ctx: { startedAt?: number | null; completedAt?: number | null } | null, lines: string[], quietSince: number | null, now = Date.now()): boolean {
  if (cliId !== "claude" || !ctx?.startedAt || ctx.completedAt || quietSince === null || quietSince < ctx.startedAt || now - quietSince < 30_000) return false;
  const tail = lines.filter((line) => line.trim() && !/^[\s─━┄┈-]+$/.test(line)).slice(-2);
  return tail.length === 2 && /^\s*❯\s*$/.test(tail[0]) && (/^\s*[⏵▶»›❯]*\s*(?:bypass permissions on|accept edits on)\b/i.test(tail[1]) || /^\s*\?\s+for shortcuts\b/i.test(tail[1]));
}

export function codexInterruptedIdle(cliId: string, ctx: { startedAt?: number | null; completedAt?: number | null } | null, lines: string[], quietSince: number | null, now = Date.now()): boolean {
  if (cliId !== "codex" || !ctx?.startedAt || ctx.completedAt || quietSince === null || quietSince < ctx.startedAt || now - quietSince < 10_000) return false;
  const tail = lines.filter((line) => line.trim()).slice(-2);
  return tail.length === 2 && /^\s*›\s*(?:Ask Codex to do anything)?\s*$/i.test(tail[0]) && /^\s*(?:gpt-[\w.-]+|o[134][\w.-]*)\b/i.test(tail[1]);
}

export function agyFirstPromptReady(lines: string[]): boolean {
  let prompt = lines.length - 1;
  while (prompt >= 0 && !/^\s*[>›❯]\s*$/.test(lines[prompt])) prompt--;
  if (prompt < 0) return false;
  const tail = lines.slice(prompt + 1).filter((line) => line.trim() && !/^[\s─━┄┈-]+$/.test(line));
  return tail.length === 1 && /^\s*\?\s+for shortcuts\b/i.test(tail[0]);
}

export const AGY_IDLE_FALLBACK_MS = 60_000;

function screenShowsWork(lines: string[]): boolean {
  return lines.slice(-6).some((line) => /esc\s+(?:to\s+)?(?:interrupt|cancel)|ctrl\+c\s+(?:to\s+)?(?:stop|cancel)|^\s*(?:thinking|working|running)(?:\s|\.|$)/i.test(line));
}

export function agyIdleScreen(
  screen: { lines: string[]; rows: number; cursorRow: number; cursorCol: number } | null,
  quietSince: number | null, lastSubmit: number, pending: boolean, now = Date.now(),
): boolean {
  if (pending || !screen || quietSince === null || quietSince <= lastSubmit || now - quietSince < AGY_IDLE_FALLBACK_MS) return false;
  const row = screen.cursorRow - (screen.rows - screen.lines.length);
  if (row < 0 || row >= screen.lines.length || !/^\s*[>›❯]\s*$/.test(screen.lines[row])) return false;
  if (screenShowsWork(screen.lines)) return false;
  const promptCol = screen.lines[row].search(/[>›❯]/);
  return screen.cursorCol >= promptCol + 1 && screen.cursorCol <= promptCol + 2 && agyFirstPromptReady(screen.lines);
}

export function idleScreenFallback(
  cliId: string, screen: { lines: string[]; rows: number; cursorRow: number; cursorCol: number } | null,
  quietSince: number | null, lastSubmit: number, pending: boolean, now = Date.now(),
): boolean {
  if (cliId === "antigravity") return agyIdleScreen(screen, quietSince, lastSubmit, pending, now);
  if (pending || !screen || screenShowsWork(screen.lines) || quietSince === null || quietSince <= lastSubmit || now - quietSince < AGY_IDLE_FALLBACK_MS) return false;
  const row = screen.cursorRow - (screen.rows - screen.lines.length);
  if (row < 0 || row >= screen.lines.length) return false;
  const prompt = cliId === "claude" ? "❯" : cliId === "codex" ? "›" : cliId === "cursor" ? "→" : "";
  if (!prompt || !new RegExp(`^\\s*${prompt}\\s*$`).test(screen.lines[row])) return false;
  const col = screen.lines[row].indexOf(prompt);
  if (screen.cursorCol < col + 1 || screen.cursorCol > col + 2) return false;
  if (cliId === "claude") return claudeIdleFallback(cliId, { startedAt: 1 }, screen.lines, quietSince, now);
  if (cliId === "codex") return codexInterruptedIdle(cliId, { startedAt: 1 }, screen.lines, quietSince, now);
  return !screen.lines.slice(-5).some((line) => /ctrl\+c\s+to\s+stop|\brunning\b|\bapproval\b|\ballow\b/i.test(line));
}

export function agyIdleFallback(
  ctx: { startedAt?: number | null; completedAt?: number | null; source: string; sourceModifiedAt?: number | null } | null,
  screen: { lines: string[]; rows: number; cursorRow: number; cursorCol: number } | null,
  quietSince: number | null, lastSubmit: number, pending: boolean, now = Date.now(),
): boolean {
  if (!ctx?.startedAt || ctx.completedAt || !ctx.sourceModifiedAt || now - ctx.sourceModifiedAt < AGY_IDLE_FALLBACK_MS || ctx.source.startsWith("agy:") || ctx.source.startsWith("pty:") || quietSince === null || quietSince < ctx.startedAt) return false;
  return idleScreenFallback("antigravity", screen, quietSince, lastSubmit, pending, now);
}
export const STUCK_AFTER_MS = 15_000;
export const ECHO_WINDOW_MS = 1_500;

// quiet = apiGetSessionQuietSince: null이면 출력이 10초 안에 있는 작업 중, 숫자면 출력이 멈춘 시각(= 마지막 출력 시각).
export function deliveryGate(p: PendingDelivery | undefined, evidence: boolean, quiet: number | null, now: number): GateAction {
  if (!p || evidence) return "proceed";
  if (p.unconfirmed) return "stuck";
  const since = (p.retriedAt ?? p.at) + ECHO_WINDOW_MS;
  if (quiet === null ? now > since : quiet > since) p.started = true;
  if (quiet === null) return "wait"; // 작업 중: 재전송·멈춤 표시 없이 대기
  if (p.started) return "proceed";
  if (p.retriedAt === undefined) return "resend"; // Enter만 1회 재전송하고 대기
  return now - p.retriedAt > STUCK_AFTER_MS ? "stuck" : "wait";
}
