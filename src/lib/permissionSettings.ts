// 일반 CLI 실행 권한 모드: 모든 실행 경로(프로젝트 패널·분할 슬롯·자동 인수인계)가 여기서 읽도록 localStorage에 단일 보관
export type PermMode = "full_auto" | "manual" | "custom";

export const DEFAULT_CLI_FLAGS: Record<string, { flag: string; desc: string }> = {
  claude: { flag: "--dangerously-skip-permissions", desc: "Claude 공식 무인 권한 스킵" },
  codex: { flag: "--sandbox workspace-write --ask-for-approval never", desc: "Codex 공식 전자율 실행" },
  grok: { flag: "--yolo", desc: "Grok 공식 Yolo 승인 스킵" },
  antigravity: { flag: "--dangerously-skip-permissions --mode auto", desc: "에이전틱 계획 & 승인 자동화" },
  cursor: { flag: "--trust", desc: "Cursor 워크스페이스 신뢰 모드" },
  opencode: { flag: "", desc: "환경변수로 모든 권한 자동 승인" },
  aider: { flag: "--yes-always", desc: "Aider 자동 파일 변경 승인" },
  ollama: { flag: "--yolo", desc: "로컬 모델 자동 승인" },
};

const KEY = "agentrix_perm_settings";

export function loadPermSettings(): { mode: PermMode; flags: Record<string, string> } {
  const defaults = Object.fromEntries(Object.entries(DEFAULT_CLI_FLAGS).map(([id, v]) => [id, v.flag]));
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { mode: saved.mode ?? "manual", flags: { ...defaults, ...saved.flags } };
  } catch {
    return { mode: "manual", flags: defaults };
  }
}

export function savePermSettings(mode: PermMode, flags: Record<string, string>) {
  localStorage.setItem(KEY, JSON.stringify({ mode, flags }));
}

export function permissionLaunch(cliId: string): { args: string[]; auto: boolean } {
  const { mode, flags } = loadPermSettings();
  const flag = mode === "manual" ? "" : mode === "custom" ? flags[cliId] ?? "" : DEFAULT_CLI_FLAGS[cliId]?.flag ?? "";
  return { args: flag.trim().split(/\s+/).filter(Boolean), auto: mode === "full_auto" };
}
