/**
 * T1793692464223_2 — Sentinel 회귀·보안 검증 (_1 통합·취소 closed)
 * Critical/High 발견 시 릴리스 차단 기준에 맞춤.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "src/lib/blackboardDispatch.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api, require: () => ({}) });

test("T1793692464223_2: 앞 표시 우선 — 완료/대기 메모의 통합·취소 단어는 closed 오판 없음", () => {
  assert.equal(api.statusKind("✅ 완료 (… 통합 …)"), "done");
  assert.equal(api.statusKind("✅ 완료 (T1_2 통합)"), "done");
  assert.equal(api.statusKind("⏳ 대기 (통합 예정)"), null);
  assert.equal(api.statusKind("⏳ 대기 (취소 아님)"), null);
  assert.equal(api.statusKind("🔥 착수 (취소 검토)"), "start");
  assert.equal(api.statusKind("🔥 착수 (완료 기준 확인 중)"), "start");
});

test("T1793692464223_2: cancel 정규식은 cancelled/canceled만 closed — cancellation 메모 오판 없음", () => {
  assert.equal(api.statusKind("cancelled"), "closed");
  assert.equal(api.statusKind("canceled"), "closed");
  assert.equal(api.statusKind("cancellation memo"), null);
  assert.equal(api.statusKind("Cancellation of duplicate work"), null);
  assert.equal(api.statusKind("pending cancellation review"), null);
  // match 대안이 cancel(?:l)?ed 이므로 cancellation 부분일치로 closed가 되면 안 됨
  assert.equal("cancellation".match(/cancel(?:l)?ed/i), null);
});

test("T1793692464223_2: 통합/취소 행은 전달·완료보고 대상 제외, 기존 ⏳/🔥/✅·미완료 메일 부정어 불변", () => {
  const board = [
    "| ID | 작업 | 담당 | 선행 | 기준 | 상태 |",
    "|---|---|---|---|---|---|",
    "| R1 | a | agentA | — | x | 통합 → R9 |",
    "| R2 | b | agentA | — | x | 취소 |",
    "| R3 | c | agentA | — | x | merged |",
    "| R4 | d | agentA | — | x | cancelled |",
    "| R5 | e | agentA | — | x | ✅ 완료 (통합 반영) |",
    "| R6 | f | agentA | — | x | ⏳ 대기 (통합 예정) |",
    "| R7 | g | agentA | — | x | 🔥 착수 |",
    "| R8 | h | agentA | — | x | cancellation follow-up |",
  ].join("\n");
  const withWait = api.parseBoardTasks(board, ["agentA"], undefined, true);
  const st = Object.fromEntries(withWait.map((t) => [t.taskId, t.status]));
  assert.equal(
    JSON.stringify(st),
    JSON.stringify({
      R1: "closed",
      R2: "closed",
      R3: "closed",
      R4: "closed",
      R5: "done",
      R6: "wait",
      R7: "start",
    }),
  );
  assert.ok(!st.R8, "cancellation 메모만 있는 행은 상태 미인식(전달 대상 아님)");

  const deliverable = withWait.filter((t) => t.status !== "wait" && t.status !== "closed");
  assert.equal(deliverable.map((t) => `${t.taskId}:${t.status}`).join(","), "R5:done,R7:start");
  for (const t of withWait.filter((x) => x.status === "closed")) {
    assert.equal(api.boardTaskColumn({ status: t.status, manual: false, confirmed: false, live: true, queued: false }), "done");
  }

  // 미완료 등 기존 메일 부정어 처리 회귀 없음 (closed와 독립)
  assert.equal(
    api.hasTaskResultMail([{ from: "agentA", to: "pm", subject: "R5 작업 완료", body: "결과" }], "R5", "agentA", "pm"),
    true,
  );
  assert.equal(
    api.hasTaskResultMail([{ from: "agentA", to: "pm", subject: "R5 미완료", body: "결과" }], "R5", "agentA", "pm"),
    false,
  );
  assert.equal(
    api.hasTaskResultMail([{ from: "agentA", to: "pm", subject: "R5 완료 문의", body: "결과" }], "R5", "agentA", "pm"),
    false,
  );
});

test("T1793692464223_2: 프로젝트 보드 격리를 깨는 전역 상태/경로 없음 + App closed skip", () => {
  assert.equal(typeof api.parseBoardTasks, "function");
  // 순수 문자열 파서 — FS/전역 저장소 없음(프로젝트 보드 격리는 App의 project 키에만 의존)
  assert.doesNotMatch(source, /(?:^|\n)\s*(?:import|require)\s*\(?.*(?:fs|path|localStorage)/m);
  assert.doesNotMatch(source, /readFileSync|writeFileSync|globalThis|localStorage|window\./);
  const app = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8").replace(/\r/g, "");
  assert.match(app, /if \(t\.status === "wait" \|\| t\.status === "closed"\) continue;/);
  assert.match(app, /prevStartsRef = useRef<Record<string,/);
  assert.match(app, /prevStartsRef\.current\[project\]/);
  // closed는 start가 아니므로 forgetEndedStarts 정리 대상(재전달 방지)
  const sent = new Set(["R1:start:agentA"]);
  assert.equal(api.forgetEndedStarts(sent, [{ taskId: "R1", agentId: "agentA", status: "closed" }]), true);
  assert.ok(!sent.has("R1:start:agentA"));
});
