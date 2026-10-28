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
