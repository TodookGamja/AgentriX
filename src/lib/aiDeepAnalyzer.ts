import type { AiProviderConfig, ProjectAgentInput, ProjectDeepContext } from "../types/types";
import { apiRunCliDeepAnalysis } from "./tauriBridge";

export interface AiTestResult {
  ok: boolean;
  message: string;
}

/** 팀 편성에 사용할 수 있는 CLI와 각 CLI의 선택 가능한 모델 (사용자가 고른 설치된 CLI만 전달) */
export interface TeamCliOption {
  id: string;
  name: string;
  models: string[];
}

const DEFAULT_CLIS = ["claude", "codex", "antigravity", "grok"];

// 허용 목록(사용자가 선택한 설치된 CLI) 밖의 CLI는 허용 목록의 첫 번째로 대체
function pickCli(cliId: unknown, options?: TeamCliOption[]): string {
  const allowed = options?.length ? options.map((o) => o.id) : DEFAULT_CLIS;
  return typeof cliId === "string" && allowed.includes(cliId) ? cliId : allowed[0];
}

// 목록에 없는 모델명(환각)은 버리고 CLI 기본 모델 사용
function pickModel(cliId: unknown, model: unknown, options?: TeamCliOption[]): string {
  const opt = options?.find((o) => o.id === cliId);
  return opt && typeof model === "string" && opt.models.includes(model) ? model : "";
}

/** 사용자 요청과 재추천 시 변주를 위한 힌트 */
export interface TeamHints {
  /** 사용자가 직접 지정한 팀 구성 요청 (이름·역할 지정 등) */
  request?: string;
  /** 이전에 추천된 에이전트 이름 — 같은 구성을 반복하지 않도록 */
  avoidNames?: string[];
}

// 매 실행마다 다른 관점으로 편성하도록 무작위 관점 부여 (같은 프로젝트라도 똑같은 팀만 나오는 문제 방지)
const TEAM_LENSES = [
  "출시 속도와 빠른 반복 중심의 소수정예",
  "품질·테스트·안정성 중심",
  "아키텍처·유지보수성 중심",
  "사용자 경험·프론트엔드 완성도 중심",
  "성능·보안·운영 중심",
  "문서화·DX·협업 프로세스 중심",
];

function buildHintsPrompt(hints?: TeamHints): string {
  const lens = TEAM_LENSES[Math.floor(Math.random() * TEAM_LENSES.length)];
  const size = 3 + Math.floor(Math.random() * 3);
  const lines = [
    "",
    "",
    `[편성 관점] 이번에는 "${lens}" 관점으로, 약 ${size}명 규모의 팀을 기획하세요. 흔한 정석 구성(PM·백엔드·프론트·QA의 반복)에 머무르지 말고 이 프로젝트에만 맞는 개성 있는 역할과 고유한 이름을 쓰세요.`,
  ];
  if (hints?.avoidNames?.length) lines.push(`[이전 추천 — 이름과 역할 구성을 겹치지 않게 새로 기획] ${hints.avoidNames.join(", ")}`);
  if (hints?.request?.trim()) lines.push(`[사용자 요청 — 최우선 반영] ${hints.request.trim().replace(/\s+/g, " ")}`);
  lines.push("에이전트 name은 서로 겹치지 않는 고유한 이름이어야 하며, 팀원끼리 이 이름으로 서로를 부르며 소통합니다.");
  return lines.join("\n");
}

function buildTeamOptionsPrompt(options?: TeamCliOption[]): string {
  if (!options || options.length === 0) return "";
  const lines = options.map(
    (o) => `- id: ${o.id} (${o.name}) / 모델: ${o.models.length ? o.models.join(", ") : "목록 없음 (빈 문자열)"}`
  );
  return [
    "",
    "",
    "[사용 가능한 AI — 이 목록에 없는 CLI는 절대 배정하지 마세요]",
    ...lines,
    "각 에이전트의 역할 난이도에 맞게 CLI와 모델을 골라 cliId, model에 채우세요 (리더/설계는 고성능 모델, 단순 반복 작업은 가벼운 모델).",
  ].join("\n");
}

const SYSTEM_PROMPT = `당신은 실리콘밸리 최고 수준의 멀티 AI 개발팀 수석 아키텍트입니다.
사용자가 제공하는 프로젝트의 코드베이스 구조, README, 설정 파일 및 기술 스택 정보를 심층 분석하여,
이 프로젝트의 개발 생산성을 극대화할 수 있는 전담 AI 에이전트 3~5인 팀을 기획해야 합니다.
배열의 첫 번째 에이전트는 반드시 작업을 분해·배정하는 총괄 리더이며, name에 "PM"을 포함해야 합니다.

반드시 오직 유효한 JSON 배열(Array) 형식으로만 응답해야 합니다. 마크다운 따옴표나 기타 설명 없이 순수 JSON만 반환하세요:
[
  {
    "name": "에이전트 이름 (예: 총괄 아키텍트 & PM)",
    "roleTitle": "구체적인 직무 타이틀",
    "cliId": "에이전트가 사용할 CLI id (아래 [사용 가능한 AI] 목록의 id 중에서만 선택)",
    "model": "해당 CLI의 모델 (아래 목록의 값 중에서만 선택, 확신이 없으면 빈 문자열)",
    "avatarEmoji": "역할에 맞는 이모지 1개 (예: 👑, 🛠️, 🎨, 🔍, 🛡️, 📊)",
    "accentColor": "HEX 색상 코드 (예: #f97316, #10b981, #8b5cf6, #ef4444, #06b6d4)",
    "rolePrompt": "에이전트에게 주입할 상세한 페르소나, 목표, 행동 규칙 및 지침 (2~3문장)",
    "reason": "이 프로젝트에 이 에이전트가 특별히 필요한 심층 분석 이유"
  }
]`;

function buildUserPrompt(context: ProjectDeepContext, options?: TeamCliOption[], hints?: TeamHints): string {
  return `다음 프로젝트 정보를 면밀히 분석하고, 이 프로젝트에 가장 적합한 전문 AI 에이전트 팀(3~5명)을 JSON으로 기획하세요:

[프로젝트 정보]
- 프로젝트명: ${context.projectName}
- 작업 경로: ${context.projectPath}
- 감지된 주요 스택: ${context.detectedStacks.join(", ")}

[디렉토리 및 파일 트리 (상위 50개)]
${context.fileTree.join("\n")}

[README 요약]
${context.readmeSnippet || "README 파일 없음"}

[핵심 설정/매니페스트 요약]
${context.manifestSnippet || "설정 파일 내용 없음"}

위 프로젝트의 도메인, 프론트/백엔드/데이터/테스트 필요성을 정확히 파악하여 전문 에이전트 팀을 편성하세요.
응답은 오직 순수 JSON 배열만 반환해야 합니다.${buildTeamOptionsPrompt(options)}${buildHintsPrompt(hints)}`;
}

function parseAgentJson(rawText: string, context: ProjectDeepContext, options?: TeamCliOption[]): ProjectAgentInput[] {
  // 마크다운 코드블록 제거
  let cleaned = rawText
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/\s*```$/m, "")
    .trim();

  // 대괄호로 둘러싸인 JSON 배열 추출 시도
  const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrayMatch) {
    cleaned = arrayMatch[0];
  }

  let parsed: any[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    try {
      const wrapped = JSON.parse(cleaned);
      parsed = Array.isArray(wrapped) ? wrapped : wrapped.agents || Object.values(wrapped)[0];
    } catch {
      throw new Error(`AI 응답 JSON 파싱 실패:\n${cleaned.slice(0, 300)}...`);
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AI가 유효한 에이전트 목록을 반환하지 않았습니다.");
  }

  const slug = context.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const used = new Set<string>();
  const uniqueName = (raw: string): string => {
    let name = raw;
    for (let n = 2; used.has(name.trim().toLowerCase()); n++) name = `${raw} ${n}`;
    used.add(name.trim().toLowerCase());
    return name;
  };
  return parsed.map((item, idx) => ({
    id: `deep-ai-${slug}-${idx + 1}-${Date.now().toString(36)}`,
    projectPath: context.projectPath,
    name: uniqueName(item.name || `AI 에이전트 ${idx + 1}`),
    roleTitle: item.roleTitle || "전담 엔지니어",
    cliId: pickCli(item.cliId, options),
    model: pickModel(item.cliId, item.model, options),
    useWrapper: true,
    avatarEmoji: item.avatarEmoji || "🤖",
    accentColor: item.accentColor || "#6366f1",
    rolePrompt: item.rolePrompt || "",
    autoBrief: true,
  }));
}

export async function generateDeepAiTeamWithCli(
  cliId: string,
  context: ProjectDeepContext,
  options?: TeamCliOption[],
  hints?: TeamHints
): Promise<ProjectAgentInput[]> {
  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(context, options, hints)}`;
  const resultText = await apiRunCliDeepAnalysis(cliId, context.projectPath, prompt);
  return parseAgentJson(resultText, context, options);
}

export async function testAiConnection(config: AiProviderConfig): Promise<AiTestResult> {
  if (!config.apiKey && config.provider !== "ollama") {
    return { ok: false, message: "API 키를 입력해 주세요." };
  }

  try {
    if (config.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: config.model || "claude-3-5-haiku-20241022",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return { ok: true, message: "Anthropic Claude 연결 성공!" };
    }

    if (config.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model || "gpt-4o-mini",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return { ok: true, message: "OpenAI 연결 성공!" };
    }

    if (config.provider === "gemini") {
      const model = config.model || "gemini-1.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return { ok: true, message: "Google Gemini 연결 성공!" };
    }

    if (config.provider === "groq") {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model || "llama-3.3-70b-versatile",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return { ok: true, message: "Groq 연결 성공!" };
    }

    if (config.provider === "ollama") {
      const base = (config.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
      const res = await fetch(`${base}/api/tags`);
      if (!res.ok) throw new Error(`Ollama 서버 응답 없음 (${res.status})`);
      return { ok: true, message: "로컬 Ollama 연결 성공!" };
    }

    return { ok: false, message: "지원되지 않는 프로바이더입니다." };
  } catch (err: any) {
    return { ok: false, message: `연결 실패: ${err.message || String(err)}` };
  }
}

export async function generateDeepAiTeam(
  config: AiProviderConfig,
  context: ProjectDeepContext,
  options?: TeamCliOption[],
  hints?: TeamHints
): Promise<ProjectAgentInput[]> {
  const userPrompt = buildUserPrompt(context, options, hints);
  let responseText = "";

  if (config.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: config.model || "claude-3-5-sonnet-20241022",
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Anthropic API 에러 (${res.status})`);
    }
    const data = await res.json();
    responseText = data.content?.[0]?.text || "";
  } else if (config.provider === "openai" || config.provider === "groq") {
    const endpoint =
      config.provider === "groq"
        ? "https://api.groq.com/openai/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model || (config.provider === "groq" ? "llama-3.3-70b-versatile" : "gpt-4o"),
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API 에러 (${res.status})`);
    }
    const data = await res.json();
    responseText = data.choices?.[0]?.message?.content || "";
  } else if (config.provider === "gemini") {
    const model = config.model || "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API 에러 (${res.status})`);
    }
    const data = await res.json();
    responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } else if (config.provider === "ollama") {
    const base = (config.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model || "llama3.2",
        format: "json",
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama API 에러 (${res.status})`);
    const data = await res.json();
    responseText = data.message?.content || "";
  }

  return parseAgentJson(responseText, context, options);
}
