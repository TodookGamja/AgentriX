const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const app = read("src/App.tsx");
const tm = {};
vm.runInNewContext(
  ts.transpileModule(read("src/lib/teamMailDelivery.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: tm },
);

const d = (o) => ({
  id: "T16",
  agentId: "prism",
  project: "p",
  sessionId: "s",
  submittedAt: 0,
  unconfirmed: true,
  kind: "task",
  ...o,
});

test("T19: 고아 예약(대기열 대응 없음·유예 경과·미확정)만 탐지 — 실제 앞 항목·확정·유예 중은 유지", () => {
  assert.ok(tm.orphanReservation([d()], "p", "prism", new Set(), 60_000));
  assert.equal(tm.orphanReservation([d()], "p", "prism", new Set(["assign:T16"]), 60_000), undefined);
  assert.equal(tm.orphanReservation([d()], "p", "prism", new Set(), 10_000), undefined);
  assert.equal(tm.orphanReservation([d({ unconfirmed: false })], "p", "prism", new Set(), 60_000), undefined);
});

test("T19: drain이 고아를 지운 뒤 같은 팀원 다음 예약이 가능(중복 차단 해제·순서 유지)", () => {
  const deliveries = [d({ id: "gone", submittedAt: 0 })];
  const queueIds = new Set(["assign:T16"]); // 남은 head만
  const orphan = tm.orphanReservation(deliveries, "p", "prism", queueIds, 60_000);
  assert.equal(orphan?.id, "gone");
  const after = deliveries.filter((x) => !(x.id === orphan.id && x.kind === orphan.kind));
  assert.equal(tm.orphanReservation(after, "p", "prism", queueIds, 60_000), undefined);
  // 살아 있는 head 대응 예약은 여전히 막지 않음(항목 있음)
  assert.equal(tm.orphanReservation([d()], "p", "prism", queueIds, 60_000), undefined);
});

test("T19: App 배선 — orphan 정리 + lock 가드 + _9 unconfirmed/stuck 스킵 회귀", () => {
  assert.match(app, /orphanReservation\(getTeamMailDeliveries\(\)/);
  assert.match(app, /teamDeliveryLocksRef\.current\.has\(s\.id\)/);
  assert.match(app, /removeTeamMailDelivery\(orphan\.project, orphan\.agentId, orphan\.id, orphan\.kind\)/);
  assert.match(app, /if \(!item \|\| item\.stuck \|\| item\.unconfirmed\) continue/);
});
