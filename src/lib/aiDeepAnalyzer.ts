import type { AiProviderConfig, ProjectAgentInput, ProjectDeepContext } from "../types/types";
import { apiRunCliDeepAnalysis } from "./tauriBridge";

export interface AiTestResult {
  ok: boolean;
  message: string;
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
    "cliId": "claude" | "codex" | "antigravity" | "grok",
    "avatarEmoji": "역할에 맞는 이모지 1개 (예: 👑, 🛠️, 🎨, 🔍, 🛡️, 📊)",
    "accentColor": "HEX 색상 코드 (예: #f97316, #10b981, #8b5cf6, #ef4444, #06b6d4)",
    "rolePrompt": "에이전트에게 주입할 상세한 페르소나, 목표, 행동 규칙 및 지침 (2~3문장)",
    "reason": "이 프로젝트에 이 에이전트가 특별히 필요한 심층 분석 이유"
  }
]`;

function buildUserPrompt(context: ProjectDeepContext): string {
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
응답은 오직 순수 JSON 배열만 반환해야 합니다.`;
}

function parseAgentJson(rawText: string, context: ProjectDeepContext): ProjectAgentInput[] {
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
  return parsed.map((item, idx) => ({
    id: `deep-ai-${slug}-${idx + 1}-${Date.now().toString(36)}`,
    projectPath: context.projectPath,
    name: item.name || `AI 에이전트 ${idx + 1}`,
    roleTitle: item.roleTitle || "전담 엔지니어",
    cliId: ["claude", "codex", "antigravity", "grok"].includes(item.cliId) ? item.cliId : "claude",
    useWrapper: true,
    avatarEmoji: item.avatarEmoji || "🤖",
    accentColor: item.accentColor || "#6366f1",
    rolePrompt: item.rolePrompt || "",
    autoBrief: true,
  }));
}

export async function generateDeepAiTeamWithCli(
  cliId: string,
  context: ProjectDeepContext
): Promise<ProjectAgentInput[]> {
  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(context)}`;
  const resultText = await apiRunCliDeepAnalysis(cliId, context.projectPath, prompt);
  return parseAgentJson(resultText, context);
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
  context: ProjectDeepContext
): Promise<ProjectAgentInput[]> {
  const userPrompt = buildUserPrompt(context);
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

  return parseAgentJson(responseText, context);
}
