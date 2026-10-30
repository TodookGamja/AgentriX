import type { CliDefinition, ProjectAgentInput } from "../types/types";

// 쉘은 에이전트 엔진이 아니므로 제외. 배열 순서 = 대체 CLI 우선순위
const NON_AGENT_CLIS = new Set(["powershell", "cmd"]);
const FALLBACK_ORDER = ["claude", "codex", "antigravity", "grok", "opencode", "cursor"];

/** 설치되어 에이전트로 쓸 수 있는 CLI 목록 */
export const installedAgentClis = (clis: CliDefinition[]): CliDefinition[] =>
  clis.filter((c) => c.installed && !NON_AGENT_CLIS.has(c.id));

/** 설치되지 않은 CLI로 추천된 에이전트를 설치된 CLI로 교체 (설치된 CLI가 없으면 그대로) */
export const fitAgentsToInstalled = <T extends ProjectAgentInput>(agents: T[], clis: CliDefinition[]): T[] => {
  const ids = installedAgentClis(clis).map((c) => c.id);
  if (ids.length === 0) return agents;
  const fallback = FALLBACK_ORDER.find((id) => ids.includes(id)) ?? ids[0];
  return agents.map((a) => (ids.includes(a.cliId) ? a : { ...a, cliId: fallback, model: "" }));
};
