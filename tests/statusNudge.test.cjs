const { test } = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const ts = require("typescript"); const vm = require("node:vm");
const api = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/statusNudge.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api, Set });
test("T1793860863515_9: 유휴+🔥 → 알림 1회 / 작업 중 → 0 / 유예 전 → 0 / 같은 턴 중복 0 / 다음 유휴 때 최대 1회 재알림", () => {
  const mem = {}; const k = ["a:T1"];
  assert.deepEqual([...api.dueNudges(mem, k, true, 0)], []);          // 작업 중
  assert.deepEqual([...api.dueNudges(mem, k, false, 10_000)], []);    // 유예 전
  assert.deepEqual([...api.dueNudges(mem, k, false, 61_000)], k);     // 알림
  api.markNudged(mem, "a:T1");
  assert.deepEqual([...api.dueNudges(mem, k, false, 90_000)], []);    // 같은 턴 중복 0
  api.dueNudges(mem, k, true, 0);                                     // 다시 작업함
  assert.deepEqual([...api.dueNudges(mem, k, false, 61_000)], k);     // 재알림 1회
  api.markNudged(mem, "a:T1"); api.dueNudges(mem, k, true, 0);
  assert.deepEqual([...api.dueNudges(mem, k, false, 61_000)], []);    // 최대 2회
});
test("✅로 갱신돼 키가 사라지면 알림 대상 아님, 다른 팀원 키는 독립", () => {
  const mem = {};
  assert.deepEqual([...api.dueNudges(mem, [], false, 99_000)], []);
  api.markNudged(mem, "a:T1");
  assert.deepEqual([...api.dueNudges(mem, ["b:T1"], false, 99_000)], ["b:T1"]);
});

test("T24: 상한 후에도 5분→15분 간격으로 재알림, 3회째부터 PM 알림 키당 1회, busy 재무장", () => {
  const mem = {}; const k = ["a:T1"]; const t0 = 1_000_000;
  api.markNudged(mem, "a:T1", t0); api.dueNudges(mem, k, true, 0, 60_000, 2, t0); api.markNudged(mem, "a:T1", t0 + 100); // count 2 = 상한
  assert.deepEqual([...api.dueNudges(mem, k, false, 99_000, 60_000, 2, t0 + 200_000)], []); // 5분 전
  assert.deepEqual([...api.dueNudges(mem, k, false, 99_000, 60_000, 2, t0 + 400_000)], k); // 5분 후
  assert.deepEqual([...api.pmNoticeDue(mem, k)], []); // 2회까진 PM 알림 없음
  api.markNudged(mem, "a:T1", t0 + 400_000); // count 3
  assert.deepEqual([...api.dueNudges(mem, k, false, 99_000, 60_000, 2, t0 + 400_000 + 600_000)], []); // 15분 간격
  assert.deepEqual([...api.dueNudges(mem, k, false, 99_000, 60_000, 2, t0 + 400_000 + 900_000)], k);
  assert.deepEqual([...api.pmNoticeDue(mem, k)], k);
  api.markPmNotified(mem, "a:T1");
  assert.deepEqual([...api.pmNoticeDue(mem, k)], []); // 중복 0
  assert.deepEqual([...api.dueNudges(mem, k, true, 0)], []); // 일하는 중 알림 0
  assert.match(api.nudgeText(["T1"]), /이어서 끝까지/);
});
