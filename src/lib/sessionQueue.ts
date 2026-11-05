// 세션별 입력 대기열(먼더디플린식): 순수 연산만 둔다. 저장/구독은 sessionQueueStore.ts
// source: 배정(🔥 작업)·메일·보고(✅ 완료)·사용자. 자동 전달(배정/메일/보고)은 폴링이 다시 만들므로 읽기 전용 표시, 사용자 항목만 편집 가능
export type QueueSource = "assign" | "mail" | "report" | "user";
export interface QueueItem {
  id: string; // 자동 전달은 전달 키(중복 방지), 사용자 항목은 uuid
  source: QueueSource;
  preview: string;
  payload: string;
  createdAt: number;
  reason?: string; // 아직 못 들어간 사유(게이트 메시지)
  stuck?: boolean; // 입력창 제출 실패로 멈춤 → 다음 항목 보류
  unconfirmed?: boolean; // 본문을 썼지만 제출 확인 실패: 자동 및 수동 재전송 금지
  attempt?: { sessionId: string; at: number; body: string; source?: string };
}
export type QueueMap = Record<string, QueueItem[]>;

export const previewOf = (payload: string, max = 60): string => {
  const t = payload.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};

// 같은 id가 있으면 reason/stuck만 갱신(순서 유지), 없으면 뒤에 추가
export function upsertItem(map: QueueMap, sid: string, item: QueueItem): QueueMap {
  const list = map[sid] ?? [];
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return { ...map, [sid]: [...list, item] };
  const cur = list[i];
  if (cur.unconfirmed) return map;
  if (cur.reason === item.reason && cur.stuck === item.stuck && cur.unconfirmed === item.unconfirmed) return map;
  const next = list.slice();
  next[i] = { ...cur, reason: item.reason, stuck: item.stuck, unconfirmed: item.unconfirmed };
  return { ...map, [sid]: next };
}

export function removeItem(map: QueueMap, sid: string, id: string): QueueMap {
  const list = map[sid];
  if (!list?.some((x) => x.id === id)) return map;
  const rest = list.filter((x) => x.id !== id);
  const { [sid]: _drop, ...others } = map;
  return rest.length ? { ...others, [sid]: rest } : others;
}

// 위/아래 이동: 사용자 항목끼리만 자리를 바꾼다(자동 항목의 위치는 고정)
export function moveItem(map: QueueMap, sid: string, id: string, dir: -1 | 1): QueueMap {
  const list = map[sid] ?? [];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0 || list[i].source !== "user") return map;
  let j = i + dir;
  while (j >= 0 && j < list.length && list[j].source !== "user") j += dir;
  if (j < 0 || j >= list.length) return map;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return { ...map, [sid]: next };
}

// 지금 꺼낼 사용자 항목: 맨 앞 사용자 항목 1건. 앞 항목이 멈춤(stuck)이면 보류
export function nextQueueItem(list: QueueItem[] | undefined): QueueItem | undefined {
  return list?.[0];
}

export function queueReservation(item: QueueItem, session: { id: string; agentId?: string | null; cwd: string }, now: number) {
  if (!session.agentId || item.source === "user" || !item.id.startsWith(`${item.source}:`)) return null;
  const id = item.id.slice(item.source.length + 1);
  if (!id || (item.source === "report" && !id.includes(":"))) return null;
  return { id, agentId: session.agentId, project: session.cwd, sessionId: session.id, submittedAt: now,
    kind: item.source === "assign" ? "task" as const : item.source === "report" ? "report" as const : undefined, unconfirmed: true };
}

export function nextUserItem(list: QueueItem[] | undefined): QueueItem | undefined {
  const first = nextQueueItem(list);
  return first?.source === "user" && !first.stuck ? first : undefined;
}

// 자동 항목(배정/메일/보고) 정리: isFresh(key,id)가 아닌 것을 제거. 사용자 항목은 앱 재시작 후에도 남긴다
export function dropStaleAuto(map: QueueMap, isFresh: (key: string, id: string) => boolean): QueueMap {
  let next = map;
  for (const [key, list] of Object.entries(map)) {
    for (const it of list) if (it.source !== "user" && !isFresh(key, it.id)) next = removeItem(next, key, it.id);
  }
  return next;
}

// 이미 끝난 자동 항목 id: 보드에서 ✅가 된 assign:<ID>(담당자가 받아 수행했다는 증거)와, PM이 이미 결과 메일을 받은 report:<ID>:<agent>.
// 🔥 행은 배정 직후에도 🔥라서 전달 증거가 아니므로 제외한다. 근거 없는 stuck 항목은 그대로 둔다(중복 전달 방지).
export function settledAutoIds(
  list: QueueItem[] | undefined,
  doneTaskIds: ReadonlySet<string>,
  hasResultMail: (taskId: string, reporterId: string) => boolean,
  // 담당자가 이미 그 작업 ID를 언급한 메일을 보낸 assign ID(받아서 착수했다는 신호)
  ackedTaskIds: ReadonlySet<string> = new Set()
): string[] {
  const out: string[] = [];
  for (const it of list ?? []) {
    if (it.source === "assign" && (doneTaskIds.has(it.id.slice(7)) || ackedTaskIds.has(it.id.slice(7)))) out.push(it.id);
    else if (it.source === "report") {
      const [taskId, reporterId] = it.id.slice(7).split(":");
      if (taskId && reporterId && hasResultMail(taskId, reporterId)) out.push(it.id);
    }
  }
  return out;
}

// 제출 확인은 실패했지만(stuck/unconfirmed) 대상 터미널 화면에 그 항목이 이미 찍혀 있고 CLI 응답이 뒤따르면 전달된 것으로 본다.
// 조건: ① 시작 문구와 본문 끝부분(payload 마지막 40자)이 순서대로 화면에 있고 ② 본문 끝이 맨 아래 4줄(입력창 영역) 밖이며
// ③ 그 뒤에 비어 있지 않은 줄(응답)이 1줄 이상. 긴 미제출 입력은 끝이 화면 맨 아래까지 이어지므로 확정하지 않는다.
// ponytail: 화면 기록 범위(최근 줄)를 벗어난 전달은 못 알아본다. 그 경우는 기존처럼 멈춤으로 남는다.
// ponytail: Cursor/Gemini/Codex 입력창 아래 하단 UI(상태줄·안내·모드 표시)가 실측 최대 5~8줄이라 그보다 넉넉한 10줄. 짧은 응답은 정리하지 않고 사용자가 ✕로 처리(애매하면 유지).
const MIN_REPLY_LINES = 10;
const squash = (v: string) => v.replace(/\s+/g, "");
export function deliveredByScreen(list: QueueItem[] | undefined, lines: string[] | null | undefined): string[] {
  if (!lines || lines.length <= 4) return [];
  const flat = squash(lines.join(""));
  const out: string[] = [];
  for (const it of list ?? []) {
    if (!it.stuck && !it.unconfirmed) continue;
    const id = it.id.slice(it.id.indexOf(":") + 1);
    const head = it.source === "mail" ? `메일 ID: ${id}`
      : it.source === "assign" ? `[PM 배정] .ai-agents/BLACKBOARD.md 작업표의 ${id} 작업`
      : it.source === "report" ? `[완료 보고] ${id.split(":")[0]}` : "";
    const tail = squash(it.payload ?? "").slice(-40);
    if (!head || tail.length < 10) continue;
    const h = flat.indexOf(squash(head));
    const t = h < 0 ? -1 : flat.indexOf(tail, h);
    if (t < 0) continue;
    const end = t + tail.length;
    let pos = 0, endLine = -1;
    for (let i = 0; i < lines.length; i++) { pos += squash(lines[i]).length; if (pos >= end) { endLine = i; break; } }
    if (endLine < 0 || endLine >= lines.length - 4) continue;
    if (lines.slice(endLine + 1).filter((l) => l.replace(/[\s─-╿]/g, "")).length >= MIN_REPLY_LINES) out.push(it.id);
  }
  return out;
}

// 미처리 메일 목록(inbox)에 더는 없는 mail:<id> 항목 = 이미 처리·ack된 메일. 대기열에 남아 있으면 head drain이 다시 보내므로 제거 대상이다.
// 예약(전달 중) 중인 id는 진행 중일 수 있어 유지한다. 목록 조회가 실패하면 호출하지 않는다(호출부 try 안).
export function staleMailIds(list: QueueItem[] | undefined, openMailIds: ReadonlySet<string>, reservedIds: ReadonlySet<string>): string[] {
  return (list ?? []).filter((it) => it.source === "mail" && !openMailIds.has(it.id.slice(5)) && !reservedIds.has(it.id.slice(5))).map((it) => it.id);
}

// 착수 해제된 배정: 담당자의 🔥(start) 행이 더는 아닌 assign:<ID>(대기로 되돌림·행 삭제·담당 변경·통합)는 지난 작업이라 대기열에서 제거한다.
// 호출부는 보드를 정상으로 읽은 경우(행이 1개 이상)에만 부른다. 읽기 실패(빈 목록)에서는 부르지 않아 유지된다.
export function revokedAssignIds(list: QueueItem[] | undefined, startTaskIds: ReadonlySet<string>): string[] {
  return (list ?? []).filter((it) => it.source === "assign" && !startTaskIds.has(it.id.slice(7))).map((it) => it.id);
}

// 담당자의 🔥가 아닌 작업의 assign 처리 기록(handled·resolved) 키: 지워 두어야 ✅/대기 뒤 다시 🔥가 될 때 재전달이 막히지 않는다.
export function staleAssignRecordKeys(records: string[], queueKeyOf: string, startTaskIds: ReadonlySet<string>): string[] {
  const prefix = `${queueKeyOf}|assign:`;
  return records.filter((k) => k.startsWith(prefix) && !startTaskIds.has(k.slice(prefix.length)));
}

// 작업표와 연동해 끝난 작업의 대기열 항목을 찾는다(보드를 정상으로 읽은 경우에만 호출).
// - report:<ID>:<담당>: 그 행이 ✅(done)로 남아 있을 때만 유효. 취소·통합·삭제·🔥 복귀면 제거.
// - mail:<id>: 제목·본문의 작업 ID(T숫자_숫자, 단어 일치)가 하나 이상 있고 전부 ✅·취소·보드에 없음이면 끝난 작업. ID 없는 일반 메일, 진행 중(🔥·⏳) ID가 하나라도 있는 메일, 담당→PM 결과 메일(isResultMail)은 유지.
// 입력창에 이미 들어간(stuck·unconfirmed) 항목은 건드리지 않는다. assign은 revokedAssignIds·settledAutoIds가 이미 처리.
export function endedQueueIds(
  list: QueueItem[] | undefined,
  tasks: { taskId: string; status: string }[],
  mailOf: (mailId: string) => { subject: string; body: string; isResult: boolean } | undefined
): string[] {
  const status = new Map(tasks.map((t) => [t.taskId, t.status]));
  const out: string[] = [];
  for (const it of list ?? []) {
    // 닫힌 작업의 mail은 미확인/멈춤이어도 제거한다(재전송 근거가 없고 뒤 항목만 막는다). report는 기존대로 보존
    if ((it.stuck || it.unconfirmed) && it.source !== "mail") continue;
    if (it.source === "report") {
      if (status.get(it.id.slice(7).split(":")[0]) !== "done") out.push(it.id);
    } else if (it.source === "mail") {
      const m = mailOf(it.id.slice(5));
      if (!m || m.isResult) continue;
      const ids = `${m.subject} ${m.body}`.match(/\bT\d{6,}_\d+\b/g);
      if (ids?.length && ids.every((id) => ["done", "closed", undefined].includes(status.get(id)))) out.push(it.id);
    }
  }
  return out;
}
