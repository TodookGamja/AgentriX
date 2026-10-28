// 실행: npx tsx scripts/check_blackboard_dispatch.ts
import assert from "node:assert/strict";
import { parseBoardTasks } from "../src/lib/blackboardDispatch.ts";

const ids = ["rec-pm-x", "rec-ui-x", "rec-rust-x", "rec-qa-x"];

// 1. 기본 마크다운 테이블 및 백틱 매칭 테스트
const board1 = `
| ID | 작업 | 담당 | 선행 | 기준 | 상태 |
|---|---|---|---|---|---|
| T0 | 디스패처, \`rec-rust\` 참고 | 🎨 \`rec-ui\` (App.tsx) | — | ok | 🔥 착수 |
| T1 | 모듈 연결 | 🦀 \`rec-rust\` (codex) | — | ok | ⏳ 대기 |
| T3 | 검증 | 🔍 \`rec-qa\` | T1 | ok | ✅ 완료 |
| T9 | 모르는 담당 | \`rec-zzz\` | — | ok | 🔥 착수 |
| — | 쿼터 | 대기 | — | 없음 | 💤 |
`;
assert.deepEqual(parseBoardTasks(board1, ids), [
  { taskId: "T0", agentId: "rec-ui-x", status: "start" },
  { taskId: "T3", agentId: "rec-qa-x", status: "done" },
]);

// 2. 백틱 없는 텍스트 담당자 및 상태 뒤에 메모 컬럼이 있는 경우
const board2 = `
| ID | 작업 | 담당 | 상태 | 비고 |
|---|---|---|---|---|
| T10 | 리팩토링 | rec-rust | 착수 | 진행중 메모 |
| T11 | 테스트 | rec-qa | 완료 | 통과함 |
| T12 | 대기작업 | rec-ui | 대기 | 보류 |
`;
assert.deepEqual(parseBoardTasks(board2, ids), [
  { taskId: "T10", agentId: "rec-rust-x", status: "start" },
  { taskId: "T11", agentId: "rec-qa-x", status: "done" },
]);

// 3. 영문 헤더 (Status, Assignee) 및 In-Progress / Done 매칭
const board3 = `
| ID | Description | Assignee | Status |
|---|---|---|---|
| T20 | API endpoint | rec-rust | in-progress |
| T21 | UI Component | rec-ui | done |
`;
assert.deepEqual(parseBoardTasks(board3, ids), [
  { taskId: "T20", agentId: "rec-rust-x", status: "start" },
  { taskId: "T21", agentId: "rec-ui-x", status: "done" },
]);

console.log("All blackboard dispatch parser tests passed successfully!");

// 4. 심층 팀빌딩 에이전트(deep-ai-*): PM이 이름만 쓰면 매칭 불가 → 프로토콜로 ID를 알려줘야 연결됨
{
  const { boardProtocol } = await import("../src/lib/blackboardDispatch.ts");
  const deep = [
    { id: "deep-ai-app-1-m1x", name: "총괄 PM", roleTitle: "리더" },
    { id: "deep-ai-app-2-m1x", name: "백엔드 엔지니어", roleTitle: "API" },
    { id: "deep-ai-app-3-m1x", name: "QA 엔지니어", roleTitle: "테스트" },
  ];
  const deepIds = deep.map((a) => a.id);
  const byName = `| ID | 작업 | 담당 | 선행 | 기준 | 상태 |\n|---|---|---|---|---|---|\n| T1 | API | 백엔드 엔지니어 | — | ok | 🔥 착수 |`;
  assert.deepEqual(parseBoardTasks(byName, deepIds), []);
  const proto = boardProtocol(deep);
  assert.ok(!/[\r\n]/.test(proto), "PTY 주입용이라 개행이 없어야 함");
  for (const id of deepIds) assert.ok(proto.includes(`\`${id}\``));
  const byProto = `| ID | 작업 | 담당 | 선행 | 기준 | 상태 |\n|---|---|---|---|---|---|\n| T1 | API | \`deep-ai-app-2-m1x\` | — | ok | 🔥 착수 |\n| T2 | 테스트 | \`deep-ai-app-3-m1x\` | T1 | ok | ✅ 완료 |`;
  assert.deepEqual(parseBoardTasks(byProto, deepIds), [
    { taskId: "T1", agentId: "deep-ai-app-2-m1x", status: "start" },
    { taskId: "T2", agentId: "deep-ai-app-3-m1x", status: "done" },
  ]);
  console.log("Deep team protocol check passed!");
}
