const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const sq = {};
vm.runInNewContext(
  ts.transpileModule(read("src/lib/sessionQueue.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: sq },
);
const app = read("src/App.tsx");
const queue = read("src/lib/sessionQueue.ts");
const item = (id, source, extra = {}) => ({ id, source, preview: "", payload: "x".repeat(50), createdAt: 0, ...extra });

test("① 재현: 완료 작업 stuck/unconfirmed mail → ended 제거, assign은 유지", () => {
  const tasks = [{ taskId: "T1793840117765_4", status: "done" }, { taskId: "T1793847054429_8", status: "start" }];
  const mailOf = (id) =>
    id === "old"
      ? { subject: "T1793840117765_4 중간", body: "확인", isResult: false }
      : undefined;
  const list = [
    item("mail:old", "mail", { stuck: true, unconfirmed: true, reason: "입력창에 멈춤: 전달 결과 미확인" }),
    item("assign:T1793847054429_8", "assign", { reason: "앞 전달 대기" }),
  ];
  const ended = sq.endedQueueIds(list, tasks, mailOf);
  assert.deepEqual([...ended], ["mail:old"]);
  const remaining = list.filter((it) => !ended.includes(it.id));
  assert.deepEqual(remaining.map((it) => it.id), ["assign:T1793847054429_8"]);
  assert.equal(sq.nextQueueItem(remaining)?.id, "assign:T1793847054429_8");
});

test("② 미완료 작업 unconfirmed mail은 ended 제외 + upsert가 unconfirmed 덮어쓰기 0", () => {
  const tasks = [{ taskId: "T1793840117765_4", status: "start" }];
  const list = [item("mail:live", "mail", { stuck: true, unconfirmed: true })];
  assert.deepEqual(
    [...sq.endedQueueIds(list, tasks, () => ({ subject: "T1793840117765_4", body: "", isResult: false }))],
    [],
  );
  let map = sq.upsertItem({}, "prism", item("mail:live", "mail", { unconfirmed: true, stuck: true, reason: "미확인" }));
  map = sq.upsertItem(map, "prism", item("mail:live", "mail", { reason: "앞 전달 대기", stuck: false }));
  assert.equal(map.prism[0].unconfirmed, true);
  assert.equal(map.prism[0].stuck, true);
});

test("③ App/queue 배선: unconfirmed head 스킵·재전송 금지·ended→ack·delivery 해제", () => {
  assert.match(app, /queues\[key\]\?\.find\(\(item\) => !item\.unconfirmed\)\?\.id !== meta\.id/);
  assert.match(app, /미확인\(unconfirmed\) 항목은 재전송하지 않되 뒤 항목을 막지 않는다/);
  assert.match(app, /endedQueueIds\(/);
  assert.match(app, /for \(const id of ended\)/);
  assert.match(app, /apiAcknowledgeTeamMail\(project, s\.agentId, id\.slice\(5\)\)/);
  assert.match(app, /removeTeamMailDelivery\(project, s\.agentId, itemId, kind\)/);
  assert.match(queue, /source !== "mail"\) continue/);
  assert.match(queue, /닫힌 작업의 mail은 미확인/);
});

test("④ drain은 stuck|unconfirmed head면 세션 스킵(재전송 0 경로)", () => {
  assert.equal(sq.nextQueueItem([item("mail:a", "mail", { unconfirmed: true }), item("assign:T1", "assign")])?.id, "mail:a");
  assert.match(app, /if \(!item \|\| item\.stuck \|\| item\.unconfirmed\) continue/);
});
