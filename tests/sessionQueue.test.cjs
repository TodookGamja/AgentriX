const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const js = ts.transpileModule(fs.readFileSync("src/lib/sessionQueue.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api });

const it = (id, source, extra = {}) => ({ id, source, preview: id, payload: id, createdAt: 1, ...extra });

test("queue: auto items dedupe by id, user items drain one at a time and a stuck head blocks the rest", () => {
  let q = api.upsertItem({}, "a", it("assign:T1", "assign", { reason: "응답 중" }));
  q = api.upsertItem(q, "a", it("assign:T1", "assign", { reason: "입력창 대기" }));
  assert.equal(q.a.length, 1);
  assert.equal(q.a[0].reason, "입력창 대기");
  q = api.upsertItem(q, "a", it("u1", "user"));
  q = api.upsertItem(q, "a", it("u2", "user"));
  assert.equal(api.nextUserItem(q.a), undefined); // 자동 항목이 앞에 있으면 기다림
  q = api.removeItem(q, "a", "assign:T1");
  assert.equal(api.nextUserItem(q.a).id, "u1");
  q = api.upsertItem(q, "a", it("u1", "user", { stuck: true }));
  assert.equal(api.nextUserItem(q.a), undefined); // 멈춤이면 u2도 보류
  q = api.removeItem(q, "a", "u1");
  assert.equal(api.nextUserItem(q.a).id, "u2");
});

test("queue: move swaps only user items, removing the last item drops the session key", () => {
  let q = {};
  for (const x of [it("u1", "user"), it("m1", "mail"), it("u2", "user")]) q = api.upsertItem(q, "a", x);
  q = api.moveItem(q, "a", "u2", -1);
  assert.equal(q.a.map((x) => x.id).join(), "u2,m1,u1");
  assert.equal(api.moveItem(q, "a", "m1", 1), q); // 자동 항목은 고정
  assert.equal(api.moveItem(q, "a", "u2", -1), q); // 끝에서 더 못 감
  for (const id of ["u1", "u2", "m1"]) q = api.removeItem(q, "a", id);
  assert.equal(Object.keys(q).length, 0);
});

test("queue: stale auto items are dropped, user items survive; preview is one short line", () => {
  let q = {};
  for (const x of [it("m1", "mail"), it("m2", "mail"), it("u1", "user")]) q = api.upsertItem(q, "a", x);
  q = api.dropStaleAuto(q, (_k, id) => id === "m2");
  assert.equal(q.a.map((x) => x.id).join(), "m2,u1");
  assert.ok(q.a.some((x) => x.id === "u1") && !q.a.some((x) => x.id === "m1"));
  const p = api.previewOf("줄1\n\n줄2 " + "가".repeat(100));
  assert.ok(!p.includes("\n") && p.length === 60 && p.endsWith("…"));
});

test("T7: 자동 항목 수동 처리 — 게이트가 resolved를 소비해 재전송 없이 완료 처리, 패널은 모든 항목에 보내기/버리기", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  const gate = app.slice(app.indexOf("const sendToIdleTeamSession = async"), app.indexOf("const sendToIdleTeamSessionRaw"));
  assert.match(gate, /q\.resolved\.includes\(`\$\{key\}\|\$\{meta\.id\}`\)[\s\S]*?return false;[\s\S]*?await sendToIdleTeamSessionRaw/);
  assert.match(gate, /payload: prompt/); // 자동 항목도 payload 보관(지금 보내기용)
  const tp = fs.readFileSync("src/components/TerminalPane.tsx", "utf8");
  assert.match(tp, /auto && hasPendingSessionInput\(session\.id\) && !window\.confirm/);
  assert.match(tp, /sendQueuedNow\(it\.id, it\.payload, it\.source !== "user"\)/);
  assert.match(tp, /\.resolve\(qKey, it\.id\)/);
  assert.match(tp, /it\.source === "user" && <>/); // ↑↓는 사용자 항목만
  // 스토어: resolve = 항목 제거 + resolved 등록
  const st = fs.readFileSync("src/lib/sessionQueueStore.ts", "utf8");
  assert.match(st, /resolve: \(sid, id\) => set\([\s\S]*?removeItem[\s\S]*?`\$\{sid\}\|\$\{id\}`/);
});
