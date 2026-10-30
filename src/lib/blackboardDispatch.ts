// 블랙보드 작업표(| T1 | 작업 | `rec-ui` ... | 선행 | 기준 | 🔥 착수 |)에서 배정/완료 행을 추출
export interface BoardTask {
  taskId: string;
  agentId: string;
  status: "start" | "done";
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

export function parseBoardTasks(board: string, agentIds: string[], names?: Record<string, string>): BoardTask[] {
  const tasks: BoardTask[] = [];
  const lines = board.split(/\r?\n/);
  let statusColIdx = -1;
  let roleColIdx = -1;

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
      continue;
    }

    // 마크다운 표 구분선 (|---|---|) 건너뛰기
    if (cells.some((c) => c.startsWith("---") || c.startsWith(":---") || c.startsWith("-"))) {
      if (cells.filter(Boolean).every((c) => /^:?-+:?$/.test(c))) continue;
    }

    const taskId = cells[1];
    if (!/^T\w+$/i.test(taskId ?? "")) continue;

    const status = statusColIdx > 0 && statusColIdx < cells.length
      ? cells[statusColIdx]
      : ([...cells].reverse().find((c) => c) ?? "");

    const kind = status.includes("🔥") || status.includes("착수") || status.toLowerCase().includes("in-progress")
      ? "start"
      : status.includes("✅") || status.includes("완료") || status.toLowerCase().includes("done")
      ? "done"
      : null;
    if (!kind) continue;

    const targetCell = roleColIdx > 0 && roleColIdx < cells.length ? cells[roleColIdx] : (cells[3] ?? "");
    const backtickTokens = [...targetCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const wordTokens = targetCell.split(/[\s,()|]+/).filter(Boolean);
    const candidateTokens = backtickTokens.length > 0 ? backtickTokens : wordTokens;

    const agentId =
      agentIds.find((id) => candidateTokens.some((t) => id === t || id.startsWith(t + "-") || id.includes(t))) ??
      (names ? findAgentByName(targetCell, names) : undefined);
    if (agentId) {
      tasks.push({ taskId, agentId, status: kind });
    }
  }
  return tasks;
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
  return `[총괄 협업 규칙] 당신은 조율만 담당합니다. 코드 구현, 수정, 테스트를 직접 수행하거나 자체 하위 에이전트를 생성하지 마세요. 등록된 다른 팀원에게 작업을 배정하고 결과를 확인하세요. [작업표 규칙] .ai-agents/BLACKBOARD.md에 "| ID | 작업 | 담당 | 선행 | 기준 | 상태 |" 표로 작업을 적으세요. 이번 작업 ID는 ${taskPrefix}1, ${taskPrefix}2처럼 지정하고, 담당 칸에는 아래 팀원의 이름을 정확히 쓰고, 상태는 ⏳ 대기 / 🔥 착수 / ✅ 완료 중 하나만 씁니다. 🔥 착수로 바꾸면 담당 에이전트 터미널에 자동 전달되고, ✅ 완료되면 당신에게 보고됩니다. BLACKBOARD.md는 셸 명령(PowerShell 등)이 아닌 파일 편집 도구로 UTF-8 그대로 수정하세요(한글·이모지 깨짐 방지). 팀원: ${roster}`;
}

export function mailProtocol(agentId: string, agents: { id: string; name: string; roleTitle: string }[]): string {
  const roster = agents.filter((a) => a.id !== agentId).map((a) => `${a.name}(${a.roleTitle})`).join(", ");
  return `[팀 메시지] 팀원에게 요청, 질문, 결과를 보내려면 .ai-agents/agents/${agentId}/outbox/에 고유한 이름의 JSON 파일을 파일 편집 도구로 작성하세요. 형식: {"to":"수신 팀원 이름","subject":"제목","body":"내용"}. 임시 파일을 작성한 다음 .json으로 이름을 바꾸세요. 앱이 수신 팀원에게 전달합니다. 팀원은 이름으로 부르세요. 수신 가능한 팀원: ${roster}. 요청에는 답변하고, 결과 통보에는 불필요한 답장을 하지 마세요.`;
}
