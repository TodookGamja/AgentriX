// 일반 CLI 실행 권한 모드: 모든 실행 경로(프로젝트 패널·분할 슬롯·자동 인수인계)가 여기서 읽도록 localStorage에 단일 보관
export type PermMode = "full_auto" | "manual" | "custom";

export const DEFAULT_CLI_FLAGS: Record<string, { flag: string; desc: string }> = {
  claude: { flag: '--dangerously-skip-permissions --settings {\\"sandbox\\":{\\"enabled\\":false}}', desc: "Claude 승인 생략 및 샌드박스 해제" },
  codex: { flag: "--sandbox danger-full-access --ask-for-approval never", desc: "Codex 전체 파일 접근, 승인 없이 실행" },
  grok: { flag: "--yolo --sandbox off", desc: "Grok 승인 생략 및 샌드박스 해제" },
  antigravity: { flag: "--dangerously-skip-permissions --mode auto --sandbox=false", desc: "Antigravity 자동 승인 및 샌드박스 해제" },
  cursor: { flag: "--force --sandbox disabled --trust", desc: "Cursor 자동 승인 및 샌드박스 해제" },
  opencode: { flag: "", desc: "모든 권한 자동 승인; 별도 샌드박스는 실행 환경에 따름" },
  aider: { flag: "--yes-always", desc: "자동 파일 변경 승인; 별도 샌드박스 해제는 확인되지 않음" },
  ollama: { flag: "", desc: "Ollama CLI에는 해당 승인·샌드박스 플래그가 없음" },
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
