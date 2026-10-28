// 블랙보드 작업표(| T1 | 작업 | `rec-ui` ... | 선행 | 기준 | 🔥 착수 |)에서 배정/완료 행을 추출
export interface BoardTask {
  taskId: string;
  agentId: string;
  status: "start" | "done";
}

export function parseBoardTasks(board: string, agentIds: string[]): BoardTask[] {
  const tasks: BoardTask[] = [];
  const lines = board.split(/\r?\n/);
  let statusColIdx = -1;
  let roleColIdx = -1;

  for (const line of lines) {
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

    const agentId = agentIds.find((id) =>
      candidateTokens.some((t) => id === t || id.startsWith(t + "-") || id.includes(t))
    );
    if (agentId) {
      tasks.push({ taskId, agentId, status: kind });
    }
  }
  return tasks;
}

// PM이 디스패처가 읽을 수 있는 형식으로 작업표를 쓰도록 표 형식과 팀원 ID를 알려주는 한 줄 지침 (PTY 주입용, 개행 없음)
export function boardProtocol(agents: { id: string; name: string; roleTitle: string }[]): string {
  const roster = agents.map((a) => `\`${a.id}\`=${a.name}(${a.roleTitle})`).join(", ");
  return `[작업표 규칙] .ai-agents/BLACKBOARD.md에 "| ID | 작업 | 담당 | 선행 | 기준 | 상태 |" 표로 작업을 적으세요. ID는 T1, T2…, 담당 칸에는 아래 에이전트 ID를 백틱으로 정확히 쓰고, 상태는 ⏳ 대기 / 🔥 착수 / ✅ 완료 중 하나만 씁니다. 🔥 착수로 바꾸면 담당 에이전트 터미널에 자동 전달되고, ✅ 완료되면 당신에게 보고됩니다. BLACKBOARD.md는 셸 명령(PowerShell 등)이 아닌 파일 편집 도구로 UTF-8 그대로 수정하세요(한글·이모지 깨짐 방지). 팀원: ${roster}`;
}
