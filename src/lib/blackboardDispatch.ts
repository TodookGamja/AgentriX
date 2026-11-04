// 블랙보드 작업표(| T1 | 작업 | `rec-ui` ... | 선행 | 기준 | 🔥 착수 |)에서 배정/완료 행을 추출
export interface BoardTask {
  taskId: string;
  agentId: string;
  status: "start" | "done" | "wait" | "closed" | "invalid"; // closed: 통합·취소된 행(전달·완료 보고 없음, 작업보드에서는 완료 칸), invalid: 상태 칸이 표시로 시작하지 않음(작업보드에만 노출)
  blockedBy?: string[]; // 아직 ✅/통합/취소가 아닌 선행 작업 ID (비어 있지 않으면 전달 보류)
}

export function hasTaskResultMail(mails: { from: string; to: string; subject: string; body: string }[], taskId: string, agentId: string, pmId: string): boolean {
  return mails.some((mail) => {
    const text = `${mail.subject} ${mail.body}`;
    return mail.from === agentId && mail.to === pmId && Boolean(text.match(/[A-Za-z0-9_]+/g)?.some((word) => word === taskId)) &&
      /완료|결과|\b(?:complete[ds]?|result)\b/i.test(text) &&
      !/미완료|미완성|미해결|미처리|불가|실패|질문|문의|요청|\b(?:incomplete|failed|question|request)\b/i.test(mail.subject) &&
      !/완료(?:하지|하지는|하지를|하지는\s+못|하지\s+못|할\s+수\s+없)|완료\s*(?:안\s*됨|못)|\bnot\s+complete/i.test(mail.body);
  });
}

export function confirmedResultMail(mail: { from: string; to: string; subject: string; body: string }, tasks: BoardTask[], confirmedReports: string[], queue: string, pmId: string): boolean {
  return tasks.some((t) => (t.status === "done" || t.status === "closed") &&
    confirmedReports.includes(`${queue}|report:${t.taskId}:${t.agentId}`) &&
    hasTaskResultMail([mail], t.taskId, t.agentId, pmId));
}

export function boardTaskColumn(input: { status: BoardTask["status"]; blocked?: boolean; manual: boolean; approval?: string; confirmed: boolean; live: boolean; queued: boolean }): "approval" | "waiting" | "running" | "done" | "rejected" {
  if (input.status === "done" || input.status === "closed") return "done";
  if (input.status === "wait" || input.status === "invalid" || input.blocked) return "waiting";
  if (input.approval === "rejected") return "rejected";
  if (input.manual && (!input.approval || input.approval === "pending")) return "approval";
  return input.confirmed && input.live && !input.queued ? "running" : "waiting";
}

// 담당 칸의 팀원 이름으로 ID 찾기 (이름이 서로 포함 관계면 가장 긴 이름 우선, 동점이면 모호하므로 매칭 안 함)
function findAgentByName(cell: string, names: Record<string, string>): string | undefined {
  const text = cell.toLowerCase();
  const hits = Object.entries(names)
    .map(([id, name]) => [id, name.trim().toLowerCase()] as const)
    .filter(([, name]) => name && text.includes(name))
    .sort((a, b) => b[1].length - a[1].length);
  return hits.length === 1 || (hits.length > 1 && hits[0][1].length > hits[1][1].length) ? hits[0][0] : undefined;
}

// 상태 칸은 **맨 앞 표시**만 판정(앞의 *·_·~ 장식 허용). 뒤쪽 메모에 ⏳/🔥/✅가 섞여도 영향 없음
const STATUS_HEAD = /^[\s*_~`>-]*(⏳|대기|🔥|착수|in-progress|✅|완료|done|통합|취소|merged|cancel(?:l)?ed)/i;
const STATUS_ANYWHERE = /⏳|대기|🔥|착수|in-progress|✅|완료|done|통합|취소|merged|cancel(?:l)?ed/i;
export function statusKind(status: string): "start" | "done" | "closed" | null {
  const m = status.match(STATUS_HEAD)?.[1];
  if (!m) return null;
  if (/통합|취소|merged|cancel/i.test(m)) return "closed";
  return /🔥|착수|in-progress/i.test(m) ? "start" : /⏳|대기/.test(m) ? null : "done";
}

// 선행 칸의 ID들(전체 ID 또는 같은 묶음의 `_N` 약식). "—"·빈 칸은 없음
export function prereqIds(cell: string, taskId: string): string[] {
  const prefix = taskId.replace(/_\d+$/, "");
  const ids = (cell.match(/[A-Za-z]+\d+\w*|_\d+/g) ?? []).map((t) => (t.startsWith("_") ? prefix + t : t));
  return Array.from(new Set(ids)).filter((id) => id !== taskId);
}

// 대기 칸 정렬: 선행 충족 → 최신 묶음(ID 앞부분 숫자가 큰 것) → ID 뒤 번호 순
export function compareWaiting(a: { taskId: string; blockedBy?: string[] }, b: { taskId: string; blockedBy?: string[] }): number {
  const key = (id: string) => { const m = id.match(/(\d+)_(\d+)$/); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };
  const [ag, an] = key(a.taskId), [bg, bn] = key(b.taskId);
  return Number(Boolean(a.blockedBy?.length)) - Number(Boolean(b.blockedBy?.length)) || bg - ag || an - bn;
}

// 작업표에서 ID가 정확히 일치하는 (아직 ✅/통합/취소가 아닌) 행의 상태 칸만 "취소 — …"로 교체. 바꿀 행이 없으면 null
export function cancelBoardRow(board: string, taskId: string, note = "취소 — 사용자 작업판에서 취소"): string | null {
  const lines = board.split("\n");
  let statusIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trimStart().startsWith("|")) continue;
    const cr = raw.endsWith("\r") ? "\r" : "";
    const parts = (cr ? raw.slice(0, -1) : raw).split("|");
    const cells = parts.map((c) => c.trim());
    if (cells.some((c) => c === "상태" || c.toLowerCase() === "status")) { statusIdx = cells.findIndex((c) => c === "상태" || c.toLowerCase() === "status"); continue; }
    if (cells[1] !== taskId || statusIdx <= 0 || statusIdx >= parts.length - 1) continue;
    const kind = statusKind(cells[statusIdx]);
    if (kind === "done" || kind === "closed") continue;
    parts[statusIdx] = ` ${note} `;
    lines[i] = parts.join("|") + cr;
    return lines.join("\n");
  }
  return null;
}

export function parseBoardTasks(board: string, agentIds: string[], names?: Record<string, string>, includeWaiting = false): BoardTask[] {
  const tasks: BoardTask[] = [];
  const lines = board.split(/\r?\n/);
  let statusColIdx = -1;
  let roleColIdx = -1;
  let prereqColIdx = -1;
  const kindById = new Map<string, "start" | "done" | "wait" | "closed" | "invalid">();
  const rows: { task: BoardTask; prereq: string[] }[] = [];

  for (const line of lines) {
    // PM이 표 대신 체크리스트(- [ ] S1 담당 `작업`)로 써도 인식: [ ] → 착수, [x] → 완료. ID로 시작하지 않는 일반 체크 항목은 무시
    const box = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.+)$/);
    if (box) {
      const head = box[2].split("`")[0].replace(/\*/g, "");
      const id = head.match(/^\s*([A-Za-z]+\d+\w*)/)?.[1];
      const agentId = id && (agentIds.find((a) => head.includes(a)) ?? (names ? findAgentByName(head, names) : undefined));
      if (id && agentId) tasks.push({ taskId: id, agentId, status: box[1] === " " ? "start" : "done" });
      continue;
    }
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 3) continue;

    // 헤더 행 감지
    if (cells.some((c) => c === "상태" || c.toLowerCase() === "status")) {
      statusColIdx = cells.findIndex((c) => c === "상태" || c.toLowerCase() === "status");
      roleColIdx = cells.findIndex((c) => c === "담당" || c.toLowerCase() === "assignee" || c.toLowerCase() === "role");
      prereqColIdx = cells.findIndex((c) => c === "선행");
      continue;
    }

    // 마크다운 표 구분선 (|---|---|) 건너뛰기
    if (cells.some((c) => c.startsWith("---") || c.startsWith(":---") || c.startsWith("-"))) {
      if (cells.filter(Boolean).every((c) => /^:?-+:?$/.test(c))) continue;
    }

    const taskId = cells[1];
    if (!/^[A-Za-z]+\d+\w*$/.test(taskId ?? "")) continue;

    const status = statusColIdx > 0 && statusColIdx < cells.length
      ? cells[statusColIdx]
      : ([...cells].reverse().find((c) => c) ?? "");

    const head = status.match(STATUS_HEAD)?.[1];
    const kind = statusKind(status) ?? (head ? "wait" : STATUS_ANYWHERE.test(status) ? "invalid" : null);
    if (kind) kindById.set(taskId, kind);
    if (!kind || ((kind === "wait" || kind === "invalid") && !includeWaiting)) continue;

    const targetCell = roleColIdx > 0 && roleColIdx < cells.length ? cells[roleColIdx] : (cells[3] ?? "");
    const backtickTokens = [...targetCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const wordTokens = targetCell.split(/[\s,()|]+/).filter(Boolean);
    const candidateTokens = backtickTokens.length > 0 ? backtickTokens : wordTokens;

    const agentId =
      agentIds.find((id) => candidateTokens.some((t) => id === t || id.startsWith(t + "-") || id.includes(t))) ??
      (names ? findAgentByName(targetCell, names) : undefined);
    if (agentId) rows.push({ task: { taskId, agentId, status: kind }, prereq: prereqColIdx > 0 && prereqColIdx < cells.length ? prereqIds(cells[prereqColIdx], taskId) : [] });
  }
  // 선행이 표에 있고 ✅/통합/취소가 아니면 전달 보류. 체크리스트 행(rows 밖)·표에 없는 선행은 막지 않음
  for (const { task, prereq } of rows) {
    const blockedBy = prereq.filter((id) => { const k = kindById.get(id); return k !== undefined && k !== "done" && k !== "closed"; });
    if (blockedBy.length && task.status === "start" && !includeWaiting) continue;
    tasks.push(blockedBy.length ? { ...task, blockedBy } : task);
  }
  return tasks;
}

// 전달 기록 정리: 🔥가 아니게 된(✅/⏳) 작업의 start 기록과, 다시 🔥가 된 작업의 done 기록을 지워 재착수 시 1회 재전달
// ponytail: 표에서 행이 사라진 경우도 비-착수로 봄(빈 보드는 호출부에서 건너뜀)
export function forgetEndedStarts(sent: Set<string>, tasks: BoardTask[]): boolean {
  const live = new Set(tasks.filter((t) => t.status === "start").map((t) => `${t.taskId}:${t.agentId}`));
  let changed = false;
  for (const k of Array.from(sent)) {
    const m = k.match(/^(.+):(start|done):(.+)$/);
    if (!m) continue;
    const isLive = live.has(`${m[1]}:${m[3]}`);
    if ((m[2] === "start" && !isLive) || (m[2] === "done" && isLive)) { sent.delete(k); changed = true; }
  }
  return changed;
}

// 카드 1행용 짧은 제목: 마크다운 기호 제거 → 첫 문장 → max자 이내(넘으면 …)
export function shortTaskTitle(raw: string, max = 40): string {
  const t = raw
    .replace(/`+|\*+|_{2,}|~~|^#+\s*/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const first = t.match(/^.+?(?:[.!?。]\s|[.!?。]$|$)/)?.[0].trim() ?? t;
  return first.length > max ? first.slice(0, max - 1).trimEnd() + "…" : first;
}

// 작업 ID의 제목(표의 작업 칸 또는 체크리스트 항목 나머지) — 승인 보드 표시용
export function boardTaskTitle(board: string, taskId: string): string {
  for (const line of board.split(/\r?\n/)) {
    if (line.trimStart().startsWith("|")) {
      const c = line.split("|").map((x) => x.trim());
      if (c[1] === taskId) return c[2] ?? "";
    } else {
      const head = line.match(/^\s*[-*]\s*\[[ xX]\]\s*(.+)$/)?.[1].replace(/\*/g, "");
      if (head?.startsWith(taskId)) return head.slice(taskId.length).trim().slice(0, 80);
    }
  }
  return "";
}

// PM이 디스패처가 읽을 수 있는 형식으로 작업표를 쓰도록 표 형식과 팀원 ID를 알려주는 한 줄 지침 (PTY 주입용, 개행 없음)
export function boardProtocol(agents: { id: string; name: string; roleTitle: string }[]): string {
  const roster = agents.map((a) => `${a.name}(${a.roleTitle})`).join(", ");
  const taskPrefix = `T${Date.now()}_`;
  return `[총괄 협업 규칙] 당신은 조율만 담당합니다. 코드 구현, 수정, 테스트를 직접 수행하거나 자체 하위 에이전트를 생성하지 마세요. 등록된 다른 팀원에게 작업을 배정하고 결과를 확인하세요. [작업표 규칙] .ai-agents/BLACKBOARD.md에 "| ID | 작업 | 담당 | 선행 | 기준 | 상태 |" 표로 작업을 적으세요. 이번 작업 ID는 ${taskPrefix}1, ${taskPrefix}2처럼 지정하고, 담당 칸에는 아래 팀원의 이름을 정확히 쓰고, 상태는 ⏳ 대기 / 🔥 착수 / ✅ 완료 중 하나만 씁니다(다른 작업에 합치거나 취소한 행은 상태를 "통합 → <ID>" 또는 "취소"로 바꾸세요. 대기로 두지 마세요). 🔥 착수로 바꾸면 담당 에이전트 터미널에 자동 전달되고, ✅ 완료되면 당신에게 보고됩니다. BLACKBOARD.md는 셸 명령(PowerShell 등)이 아닌 파일 편집 도구로 UTF-8 그대로 수정하세요(한글·이모지 깨짐 방지). 팀원: ${roster}`;
}

export function mailProtocol(agentId: string, agents: { id: string; name: string; roleTitle: string }[]): string {
  const roster = agents.filter((a) => a.id !== agentId).map((a) => `${a.name}(${a.roleTitle})`).join(", ");
  return `[팀 메시지] 팀원에게 요청, 질문, 결과를 보내려면 .ai-agents/agents/${agentId}/outbox/에 고유한 이름의 JSON 파일을 파일 편집 도구로 작성하세요. 형식: {"to":"수신 팀원 이름","subject":"제목","body":"내용"}. 임시 파일을 작성한 다음 .json으로 이름을 바꾸세요. 앱이 수신 팀원에게 전달합니다. 팀원은 이름으로 부르세요. 수신 가능한 팀원: ${roster}. ${isPmName(agentId, agents) ? "요청에는 답변하세요. 결과를 받으면 답장하지 말고 .ai-agents/BLACKBOARD.md를 확인해 다음 작업을 배정하거나 모두 끝났으면 최종 보고하세요." : "요청에는 답변하고, 결과 통보에는 불필요한 답장을 하지 마세요."}`;
}

// App.tsx의 PM 판별과 같은 기준(이름·역할에 PM/리더)
function isPmName(agentId: string, agents: { id: string; name: string; roleTitle: string }[]): boolean {
  const me = agents.find((a) => a.id === agentId);
  return Boolean(me && (me.name.includes("PM") || me.roleTitle.includes("PM") || me.roleTitle.includes("리더")));
}

// 개별 출근·역할 주입에 붙이는 협업 규칙: PM(이름·역할에 PM/리더 포함)은 작업표+메일, 그 외는 메일만. App.tsx의 PM 판별과 같은 기준
export function collabProtocol(agentId: string, agents: { id: string; name: string; roleTitle: string }[]): string {
  const me = agents.find((a) => a.id === agentId);
  if (!me) return "";
  const isPm = isPmName(agentId, agents);
  const mail = mailProtocol(agentId, agents);
  return isPm ? `${boardProtocol(agents.filter((a) => a.id !== agentId))} ${mail}` : mail;
}

// 작업표 일시 오독 방지: 팀원이 BLACKBOARD.md를 쓰는 도중 읽으면 🔥 행이 한 번 사라져 보일 수 있다.
// 지난 읽기에서 🔥였던 행이 이번 읽기에서 🔥가 아니면 한 번은 아직 🔥로 간주한다(정리 판단 전용). 연속 2회 🔥가 아니어야 정리된다.
export function keepRecentStarts(prevStarts: BoardTask[], tasks: BoardTask[]): BoardTask[] {
  const live = new Set(tasks.filter((t) => t.status === "start").map((t) => `${t.taskId}:${t.agentId}`));
  return [...tasks, ...prevStarts.filter((p) => p.status === "start" && !live.has(`${p.taskId}:${p.agentId}`))];
}
