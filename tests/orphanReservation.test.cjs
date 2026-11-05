const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const src = fs.readFileSync("src/lib/teamMailDelivery.ts", "utf8");
const body = src.slice(src.indexOf("export function orphanReservation"));
const sig = body.slice(0, body.search(/\{\r?\n/)); // 시그니처(타입 포함)를 JS로 치환
const fn = new Function(`${body.replace(sig, "function orphanReservation(deliveries, project, agentId, queueIds, now, graceMs = 30000) ")}; return orphanReservation;`)();
const d = (o) => ({ id: "T1", agentId: "a", project: "p", sessionId: "s", submittedAt: 0, unconfirmed: true, kind: "task", ...o });
test("T18: 대기열에 대응 항목 없는 오래된 미확정 예약만 고아", () => {
  assert.ok(fn([d()], "p", "a", new Set(), 60_000));
  assert.equal(fn([d()], "p", "a", new Set(["assign:T1"]), 60_000), undefined); // 항목 있음
  assert.equal(fn([d()], "p", "a", new Set(), 10_000), undefined); // 유예 중
  assert.equal(fn([d({ unconfirmed: false })], "p", "a", new Set(), 60_000), undefined); // 전달 확정 = 작업 중
  assert.ok(fn([d({ kind: undefined, id: "m1" })], "p", "a", new Set(["assign:m1"]), 60_000)); // 접두사 구분
});
test("T18: drain이 고아 예약을 정리", () => {
  assert.match(fs.readFileSync("src/App.tsx", "utf8"), /orphanReservation\(getTeamMailDeliveries\(\)/);
});
