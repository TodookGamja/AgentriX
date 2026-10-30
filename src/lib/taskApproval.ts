// 수동 승인 모드: PM이 작업표에 올린 작업을 사용자가 승인해야 팀원에게 전달 (프로젝트별 localStorage)
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface TaskApproval {
  taskId: string;
  agentId: string;
  status: ApprovalStatus;
  reason?: string;
  /** 반려 사유를 PM에게 전달했는지 */
  notified?: boolean;
}

const approvalsKey = (project: string) => `agentrix_task_approvals:${project}`;
const modeKey = (project: string) => `agentrix_approval_mode:${project}`;

export const getApprovalMode = (project: string): "auto" | "manual" =>
  localStorage.getItem(modeKey(project)) === "manual" ? "manual" : "auto";

export const setApprovalMode = (project: string, mode: "auto" | "manual"): void =>
  localStorage.setItem(modeKey(project), mode);

export function getApprovals(project: string): TaskApproval[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(approvalsKey(project)) || "[]");
    return Array.isArray(v) ? (v as TaskApproval[]) : [];
  } catch {
    return [];
  }
}

export const findApproval = (project: string, taskId: string, agentId: string): TaskApproval | undefined =>
  getApprovals(project).find((a) => a.taskId === taskId && a.agentId === agentId);

export function upsertApproval(project: string, approval: TaskApproval): void {
  const rest = getApprovals(project).filter((a) => !(a.taskId === approval.taskId && a.agentId === approval.agentId));
  localStorage.setItem(approvalsKey(project), JSON.stringify([...rest, approval]));
}
