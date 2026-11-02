const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/blackboardDispatch.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api, require: () => ({}) });

test("table rows accept non-T prefixed IDs (SEC1) and ignore plain words", () => {
  const board = [
    "| ID | 작업 | 담당 | 선행 | 상태 |",
    "|---|---|---|---|---|",
    "| SEC1 | x | agentA | — | 🔥 착수 |",
    "| T1030_ORC2 | y | agentA | — | ✅ 완료 |",
    "| 비고 | z | agentA | — | 🔥 착수 |",
  ].join("\n");
  const ids = api.parseBoardTasks(board, ["agentA"]).map((t) => t.taskId);
  assert.equal(ids.join(","), "SEC1,T1030_ORC2");
});

test("status uses the first marker so done notes mentioning 🔥 stay done", () => {
  assert.equal(api.statusKind("✅ 완료 — 상태별 배지(⏳/🔥/✅) 개선안 전달"), "done");
  assert.equal(api.statusKind("🔥 착수 (완료 기준 확인 중)"), "start");
  assert.equal(api.statusKind("⏳ 대기"), null);
  assert.equal(api.statusKind("⏳ 대기 — 완료 후 재개"), null);
});

test("forgetEndedStarts: re-start after done/waiting redelivers once, steady 🔥 does not", () => {
  const t = (status) => [{ taskId: "T1", agentId: "a", status }];
  const sent = new Set(["T1:start:a"]);
  assert.equal(api.forgetEndedStarts(sent, t("start")), false); // 🔥 유지: 중복 전달 0
  assert.ok(sent.has("T1:start:a"));
  assert.equal(api.forgetEndedStarts(sent, t("done")), true); // ✅ 확인 → start 기록 삭제
  assert.equal(sent.has("T1:start:a"), false); // 다시 🔥가 되면 키가 없어 1회 재전달
  const s2 = new Set(["T1:start:a"]);
  api.forgetEndedStarts(s2, [{ taskId: "T2", agentId: "a", status: "start" }]); // ⏳로 행이 빠진 경우
  assert.equal(s2.has("T1:start:a"), false);
  const s3 = new Set(["T1:done:a"]);
  api.forgetEndedStarts(s3, t("start")); // 재착수 후 다음 완료도 PM에 보고
  assert.equal(s3.has("T1:done:a"), false);
});
