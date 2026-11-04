//! 세션의 실제 컨텍스트 토큰을 CLI가 남기는 로그에서 읽는다 (토큰 최적화 임계치 판단용).
//! 로그에 토큰이 없는 CLI(grok, cursor, 새로 추가한 CLI 등)는 None → 프론트가 화면 출력 기반 추정치로 대체한다.
//! 새 CLI를 정확하게 지원하려면 read_context의 match에 리더 함수 하나만 추가하면 된다.
use crate::usage::collect_newest_jsonl_files;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

fn antigravity_submitted_message(content: &str, body: &str, after: i64) -> bool {
    let body = body.replace("\r\n", "\n");
    let body = body.trim();
    if body.is_empty() || after <= 0 { return false; }
    content.lines().any(|line| {
        let Ok(v) = serde_json::from_str::<Value>(line) else { return false; };
        if v.get("type").and_then(Value::as_str) != Some("USER_INPUT") { return false; }
        let Some(time) = v.get("created_at").and_then(Value::as_str).and_then(parse_ts) else { return false; };
        if time.timestamp_millis() < after - after.rem_euclid(1000) { return false; }
        v.get("content").and_then(Value::as_str).is_some_and(|text| {
            text.replace("\r\n", "\n").trim() == body
        })
    })
}

pub fn submitted_user_message(content: &str, cli: &str, body: &str, after: i64) -> bool {
    if cli == "antigravity" { return antigravity_submitted_message(content, body, after); }
    let body = body.replace("\r\n", "\n");
    let body = body.trim();
    if body.is_empty() || after <= 0 { return false; }
    content.lines().any(|line| {
        let Ok(v) = serde_json::from_str::<Value>(line) else { return false; };
        let Some(time) = v.get("timestamp").and_then(Value::as_str).and_then(parse_ts) else { return false; };
        if time.timestamp_millis() <= after || v.get("isSidechain").and_then(Value::as_bool) == Some(true) { return false; }
        let text = match cli {
            "claude" if v.get("type").and_then(Value::as_str) == Some("user") => {
                match v.pointer("/message/content") {
                    Some(Value::String(text)) => Some(text.clone()),
                    Some(Value::Array(blocks)) => Some(blocks.iter()
                        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                        .filter_map(|block| block.get("text").and_then(Value::as_str))
                        .collect::<String>()),
                    _ => None,
                }
            }
            "codex" if v.get("type").and_then(Value::as_str) == Some("event_msg") && v.pointer("/payload/type").and_then(Value::as_str) == Some("user_message") => v.pointer("/payload/message").and_then(Value::as_str).map(str::to_owned),
            "codex" if v.get("type").and_then(Value::as_str) == Some("response_item") && v.pointer("/payload/type").and_then(Value::as_str) == Some("message") && v.pointer("/payload/role").and_then(Value::as_str) == Some("user") => v.pointer("/payload/content").and_then(Value::as_array).map(|blocks| blocks.iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("input_text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<String>()),
            _ => None,
        };
        text.is_some_and(|text| text.replace("\r\n", "\n").trim() == body)
    })
}

#[cfg(test)]
mod submission_tests {
    use super::{antigravity, antigravity_turn, submitted_user_message};
    #[test]
    fn exact_message_after_attempt_only() {
        let claude = r#"{"type":"user","timestamp":"2026-11-04T00:41:16.746Z","message":{"content":"hello"}}"#;
        let at = 1_793_752_876_746;
        assert!(submitted_user_message(claude, "claude", "hello", at - 1));
        assert!(!submitted_user_message(claude, "claude", "hello", at));
        assert!(!submitted_user_message(claude, "claude", "hello", at + 1));
        assert!(!submitted_user_message(claude, "claude", "hell", at));
        let codex = r#"{"type":"event_msg","timestamp":"2026-11-04T00:41:16.746Z","payload":{"type":"user_message","message":"hello"}}"#;
        assert!(submitted_user_message(codex, "codex", "hello", at - 1));
        assert!(!submitted_user_message(codex, "claude", "hello", at));
    }

    #[test]
    fn claude_text_blocks_and_codex_normalize_without_matching_old_messages() {
        let at = 1_793_752_876_746;
        let claude_string = r#"{"type":"user","timestamp":"2026-11-04T00:41:16.746Z","message":{"content":"  hello\nworld  "}}"#;
        let claude_blocks = r#"{"type":"user","timestamp":"2026-11-04T00:41:16.746Z","message":{"content":[{"type":"text","text":"hello\r\n"},{"type":"image","source":{"type":"base64","data":"ignored"}},{"type":"text","text":"world"}]}}"#;
        let codex = r#"{"type":"event_msg","timestamp":"2026-11-04T00:41:16.746Z","payload":{"type":"user_message","message":" hello\r\nworld "}}"#;
        let codex_response = r#"{"type":"response_item","timestamp":"2026-11-04T00:41:16.746Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello\nworld"}]}}"#;
        assert!(submitted_user_message(claude_string, "claude", "hello\r\nworld", at - 1));
        assert!(submitted_user_message(claude_blocks, "claude", " hello\nworld ", at - 1));
        assert!(submitted_user_message(codex, "codex", "hello\nworld", at - 1));
        assert!(submitted_user_message(codex_response, "codex", "hello\r\nworld", at - 1));
        assert!(!submitted_user_message(codex_response.replace("\"role\":\"user\"", "\"role\":\"assistant\"").as_str(), "codex", "hello\nworld", at - 1));
        assert!(!submitted_user_message(claude_blocks, "claude", "hello\nworld", at));
        assert!(!submitted_user_message(claude_blocks, "claude", "hello\nother", at - 1));
        assert!(!submitted_user_message(claude_blocks, "claude", " \r\n ", at - 1));
    }

    #[test]
    fn antigravity_turn_requires_final_response_and_quiet_log() {
        let user = r#"{"step_index":0,"type":"USER_INPUT","status":"DONE","created_at":"2026-11-04T00:41:16Z","content":"a delivered message"}"#;
        let response = r#"{"step_index":1,"type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-11-04T00:41:17Z","content":"done"}"#;
        let tool = r#"{"step_index":1,"type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-11-04T00:41:17Z","content":"working","tool_calls":[{}]}"#;
        let system = r#"{"step_index":2,"type":"SYSTEM_MESSAGE","status":"DONE","created_at":"2026-11-04T00:41:18Z"}"#;
        let (start, end) = antigravity_turn(&[user, response].join("\n"), true);
        assert!(start.is_some() && end.is_some());
        assert!(antigravity_turn(&[user, response].join("\n"), false).1.is_none());
        assert!(antigravity_turn(&[user, tool].join("\n"), true).1.is_none());
        assert!(antigravity_turn(&[user, response, system].join("\n"), true).1.is_none());
        assert!(submitted_user_message(user, "antigravity", "a delivered message", 1_793_752_876_900));
        assert!(!submitted_user_message(user, "antigravity", "a different message", 1_793_752_876_900));
        assert!(!submitted_user_message(user, "antigravity", "a delivered message", 1_793_752_877_000));
        let long_body = format!("{} original ending", "가".repeat(100));
        let truncated = serde_json::json!({"type":"USER_INPUT", "created_at":"2026-11-04T00:41:16Z", "content": "가".repeat(80)}).to_string();
        assert!(!submitted_user_message(&truncated, "antigravity", &long_body, 1_793_752_876_900));
        let exact = serde_json::json!({"type":"USER_INPUT", "created_at":"2026-11-04T00:41:16Z", "content": long_body}).to_string();
        assert!(submitted_user_message(&exact, "antigravity", &long_body, 1_793_752_876_900));
        let normalized = serde_json::json!({"type":"USER_INPUT", "created_at":"2026-11-04T00:41:16Z", "content": "  line1\r\nline2  "}).to_string();
        assert!(submitted_user_message(&normalized, "antigravity", "line1\nline2", 1_793_752_876_900));
        assert!(!submitted_user_message(&truncated, "antigravity", "다른 입력", 1_793_752_876_900));
    }

    #[test]
    fn antigravity_refuses_ambiguous_session_logs() {
        let root = std::env::temp_dir().join(format!("agentrix-agy-{}", uuid::Uuid::new_v4()));
        let started = chrono::Utc::now() - chrono::Duration::minutes(1);
        assert_eq!(antigravity(&root, started, &[]).unwrap().source, "agy:no-log");
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(antigravity(&root, started, &[]).unwrap().source, "agy:no-log");
        let invalid_dir = root.join("invalid").join(".system_generated").join("logs");
        std::fs::create_dir_all(&invalid_dir).unwrap();
        std::fs::write(invalid_dir.join("transcript.jsonl"), "invalid log").unwrap();
        assert!(antigravity(&root, started, &[]).is_none());
        std::fs::remove_dir_all(root.join("invalid")).unwrap();
        let mut paths = Vec::new();
        for id in ["one", "two"] {
            let dir = root.join(id).join(".system_generated").join("logs");
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("transcript.jsonl");
            let line = serde_json::json!({"type":"USER_INPUT", "created_at":chrono::Utc::now().to_rfc3339(), "content":"hello"}).to_string();
            std::fs::write(&path, line).unwrap();
            paths.push(path);
        }
        assert!(antigravity(&root, started, &[]).is_none());
        let claimed = vec![paths[0].to_string_lossy().into_owned()];
        assert_eq!(antigravity(&root, started, &claimed).unwrap().source, paths[1].to_string_lossy());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    /// 마지막 모델 호출 기준 컨텍스트에 들어 있는 토큰 수
    pub tokens: u64,
    /// 모델 최대 컨텍스트 (로그가 알려줄 때만)
    pub window: Option<u64>,
    /// 매칭된 로그 식별자 (같은 폴더의 다른 세션이 같은 로그를 잡지 않도록 프론트가 claimed로 돌려줌)
    pub source: String,
    pub completed_at: Option<i64>,
    pub started_at: Option<i64>,
}

/// claimed: 다른 세션이 이미 잡은 source 목록
pub fn read_context(
    cli_id: &str,
    session_id: &str,
    cwd: &str,
    started_at: &str,
    claimed: &[String],
) -> Option<ContextUsage> {
    let started = DateTime::parse_from_rfc3339(started_at).ok()?.with_timezone(&Utc);
    let home = crate::cli::home_dir();
    match cli_id {
        "claude" => claude(&home.join(".claude").join("projects"), session_id),
        "codex" => codex(&home.join(".codex").join("sessions"), cwd, started, claimed),
        "antigravity" => antigravity(&home.join(".gemini").join("antigravity-cli").join("brain"), started, claimed),
        "opencode" => opencode(&home.join(".local").join("share").join("opencode").join("opencode.db"), cwd, started, claimed),
        _ => None,
    }
}

fn same_dir(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    norm(a) == norm(b)
}

/// 세션 시작 이후(10초 여유) 수정된 파일만 후보로
fn touched_since(path: &Path, started: DateTime<Utc>) -> bool {
    let since = SystemTime::from(started) - Duration::from_secs(10);
    std::fs::metadata(path).and_then(|m| m.modified()).map(|t| t >= since).unwrap_or(false)
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

/// Claude: 앱이 --session-id로 PTY 세션 ID를 넘기므로 로그 파일명이 곧 세션 ID → 정확히 1:1
fn claude(projects: &Path, session_id: &str) -> Option<ContextUsage> {
    let file = std::fs::read_dir(projects)
        .ok()?
        .flatten()
        .map(|d| d.path().join(format!("{session_id}.jsonl")))
        .find(|p| p.is_file())?;
    let content = std::fs::read_to_string(&file).ok()?;
    let tokens = claude_last_context(&content)?;
    Some(ContextUsage { tokens, window: None, source: file.to_string_lossy().into(), completed_at: claude_completion(&content), started_at: turn_started(&content, "claude") })
}

fn claude_local_user(v: &Value) -> bool {
    v.get("isMeta").and_then(Value::as_bool) == Some(true)
        || v.get("isCompactSummary").and_then(Value::as_bool) == Some(true)
        || v.get("isVisibleInTranscriptOnly").and_then(Value::as_bool) == Some(true)
        || v.pointer("/message/content").and_then(Value::as_str).is_some_and(|content|
            ["<command-name>", "<local-command-stdout>", "<local-command-caveat>"].iter().any(|tag| content.starts_with(tag)))
}

/// Claude Code는 슬래시 명령을 입력하면 평문 user 항목("/compact")을 먼저 남기고, 뒤에 <command-name>/compact</command-name>과
/// <local-command-stdout>을 남긴다. 그 짝이 뒤따르는 평문 항목은 모델 턴이 아니라 로컬 명령이므로 줄 번호를 모아 둔다.
/// 스킬처럼 stdout 없이 모델 응답이 이어지는 명령, "/"로 시작하는 일반 프롬프트(짝 없음)는 포함하지 않는다.
fn claude_plain_local_commands(content: &str) -> std::collections::HashSet<usize> {
    let mut out = std::collections::HashSet::new();
    let mut open: Vec<(usize, String)> = Vec::new(); // (평문 항목 줄, 명령 이름) 중 command-name 짝을 기다리는 것
    let mut paired: Vec<(usize, String)> = Vec::new(); // command-name까지 나왔고 stdout을 기다리는 것
    for (i, line) in content.lines().enumerate() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v.get("type").and_then(Value::as_str) != Some("user") || v.get("isSidechain").and_then(Value::as_bool) == Some(true) { continue; }
        let Some(text) = v.pointer("/message/content").and_then(Value::as_str) else { continue };
        if let Some(name) = text.strip_prefix("<command-name>").and_then(|t| t.split("</command-name>").next()) {
            // 실제 기록은 뒤에 <command-message>·<command-args>가 붙으므로 닫는 태그까지만 이름으로 본다
            let name = name.trim().to_string();
            if let Some(p) = open.iter().rposition(|(_, n)| *n == name) { paired.push(open.remove(p)); }
        } else if text.starts_with("<local-command-stdout>") {
            out.extend(paired.drain(..).map(|(idx, _)| idx));
        } else if !claude_local_user(&v) {
            if let Some(cmd) = text.strip_prefix('/').and_then(|t| t.split_whitespace().next()) {
                open.push((i, format!("/{cmd}")));
            }
        }
    }
    out
}

fn turn_started(content: &str, cli: &str) -> Option<i64> {
    let plain = if cli == "claude" { claude_plain_local_commands(content) } else { Default::default() };
    let total = content.lines().count();
    content.lines().rev().enumerate().find_map(|(r, line)| {
        let idx = total - 1 - r;
        let v: Value = serde_json::from_str(line).ok()?;
        if v.get("isSidechain").and_then(Value::as_bool) == Some(true) { return None; }
        let started = if cli == "claude" {
            v.get("type").and_then(Value::as_str) == Some("user") && !claude_local_user(&v) && !plain.contains(&idx)
        } else {
            v.get("type").and_then(Value::as_str) == Some("event_msg") && matches!(v.pointer("/payload/type").and_then(Value::as_str), Some("user_message" | "task_started"))
        };
        started.then(|| v.get("timestamp").and_then(Value::as_str).and_then(parse_ts).map(|t| t.timestamp_millis())).flatten()
    })
}

fn claude_completion(content: &str) -> Option<i64> {
    let mut local_output_at = None;
    let plain = claude_plain_local_commands(content);
    let total = content.lines().count();
    for (r, line) in content.lines().rev().enumerate() {
        let idx = total - 1 - r;
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v.get("isSidechain").and_then(Value::as_bool) == Some(true) { continue; }
        match v.get("type").and_then(Value::as_str) {
            Some("user") if claude_local_user(&v) || plain.contains(&idx) => {
                if local_output_at.is_none() && v.pointer("/message/content").and_then(Value::as_str).is_some_and(|text| text.starts_with("<local-command-stdout>")) {
                    local_output_at = v.get("timestamp").and_then(Value::as_str).and_then(parse_ts).map(|t| t.timestamp_millis());
                }
            }
            Some("user") => return None,
            Some("assistant") => return (v.pointer("/message/stop_reason").and_then(Value::as_str) == Some("end_turn"))
                .then(|| v.get("timestamp").and_then(Value::as_str).and_then(parse_ts).map(|t| t.timestamp_millis()))
                .flatten().map(|completed| local_output_at.map_or(completed, |local| completed.max(local))),
            _ => {}
        }
    }
    None
}

fn codex_completion(content: &str) -> Option<i64> {
    for line in content.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        match v.pointer("/payload/type").and_then(Value::as_str) {
            Some("task_started" | "user_message") => return None,
            Some("task_complete") => return v.get("timestamp").and_then(Value::as_str).and_then(parse_ts).map(|t| t.timestamp_millis()),
            _ => {}
        }
    }
    None
}

fn opencode_completion(v: &Value, matches: usize) -> Option<i64> {
    (matches == 1 && v.get("role").and_then(Value::as_str) == Some("assistant") && v.get("finish").and_then(Value::as_str) == Some("stop"))
        .then(|| v.pointer("/time/completed").and_then(Value::as_i64)).flatten()
}

fn claude_last_context(content: &str) -> Option<u64> {
    content.lines().rev().find_map(|line| {
        if !line.contains("\"usage\"") {
            return None;
        }
        let v: Value = serde_json::from_str(line).ok()?;
        // 서브에이전트(사이드체인) 호출은 메인 대화 컨텍스트가 아님
        if v.get("isSidechain").and_then(|x| x.as_bool()) == Some(true) {
            return None;
        }
        let u = v.get("message")?.get("usage")?;
        let n = |k: &str| u.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
        let total = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens") + n("output_tokens");
        (total > 0).then_some(total)
    })
}

/// Codex: rollout 첫 줄(session_meta)의 cwd·시작 시각으로 매칭, 마지막 token_count의 last_token_usage가 현재 컨텍스트
// ponytail: 같은 폴더에서 Codex 세션을 동시에 여러 개 띄우면 시작 시각 순서로 짝지음, 거의 동시에 띄우면 뒤바뀔 수 있음
fn codex(sessions: &Path, cwd: &str, started: DateTime<Utc>, claimed: &[String]) -> Option<ContextUsage> {
    let mut best: Option<(DateTime<Utc>, PathBuf, String)> = None;
    let mut matches = 0;
    for path in collect_newest_jsonl_files(sessions, 5, 40, None) {
        if !touched_since(&path, started) {
            break; // 최신순 정렬이라 이후 파일은 전부 더 오래됨
        }
        let src = path.to_string_lossy().to_string();
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        let Some(meta) = content.lines().next().and_then(|l| serde_json::from_str::<Value>(l).ok()) else { continue };
        let payload = meta.get("payload");
        let meta_cwd = payload.and_then(|p| p.get("cwd")).and_then(|x| x.as_str()).unwrap_or("");
        let Some(ts) = payload.and_then(|p| p.get("timestamp")).and_then(|x| x.as_str()).and_then(parse_ts) else { continue };
        if !same_dir(meta_cwd, cwd) || ts < started - chrono::Duration::seconds(10) {
            continue;
        }
        if claimed.contains(&src) { continue; }
        matches += 1;
        if best.as_ref().map(|b| ts < b.0).unwrap_or(true) {
            best = Some((ts, path, content));
        }
    }
    let (_, path, content) = best?;
    let (tokens, window) = codex_last_context(&content)?;
    Some(ContextUsage { tokens, window, source: path.to_string_lossy().into(), completed_at: if matches == 1 { codex_completion(&content) } else { None }, started_at: if matches == 1 { turn_started(&content, "codex") } else { None } })
}

fn codex_last_context(content: &str) -> Option<(u64, Option<u64>)> {
    content.lines().rev().find_map(|line| {
        if !line.contains("\"token_count\"") {
            return None;
        }
        let v: Value = serde_json::from_str(line).ok()?;
        let info = v.get("payload")?.get("info")?;
        let tokens = info.get("last_token_usage")?.get("total_tokens")?.as_u64()?;
        Some((tokens, info.get("model_context_window").and_then(|x| x.as_u64())))
    })
}

pub fn codex_log_for_session(sessions: &Path, cwd: &str, id: &str) -> Option<PathBuf> {
    let id = uuid::Uuid::parse_str(id).ok()?.to_string();
    let suffix = format!("{id}.jsonl");
    walkdir::WalkDir::new(sessions).max_depth(5).into_iter().flatten()
        .filter(|entry| entry.file_type().is_file() && entry.file_name().to_string_lossy().ends_with(&suffix))
        .find_map(|entry| {
            let content = std::fs::read_to_string(entry.path()).ok()?;
            let meta: Value = serde_json::from_str(content.lines().next()?).ok()?;
            let payload = meta.get("payload")?;
            (payload.get("id")?.as_str()? == id && same_dir(payload.get("cwd")?.as_str()?, cwd))
                .then(|| entry.into_path())
        })
}

// 이어하기(resume)로 열린 Codex 세션인데 PTY에 resumed id가 없을 때의 대체: 에이전트에 저장된 Codex 대화 id의 로그가 이 세션 시작 이후 갱신됐으면 그 로그를 쓴다.
// 이어하기 로그는 첫 줄 시각이 과거라 read_context의 시작 시각 매칭(10초)에 영원히 안 걸려 ctx가 None이 되고, 턴 종료 판정이 막힌다.
// ponytail: 에이전트당 세션은 1개라 저장 id가 곧 이 세션. 새 대화로 시작했다면 옛 로그는 시작 이후 갱신되지 않아 제외된다.
pub fn saved_codex_log_in_use(sessions: &Path, cwd: &str, id: &str, started_at: &str) -> Option<String> {
    let started = parse_ts(started_at)?;
    let path = codex_log_for_session(sessions, cwd, id)?;
    touched_since(&path, started).then(|| id.to_string())
}

pub fn read_codex_session(path: &Path) -> Option<ContextUsage> {
    let content = std::fs::read_to_string(path).ok()?;
    let (tokens, window) = codex_last_context(&content)?;
    Some(ContextUsage { tokens, window, source: path.to_string_lossy().into(), completed_at: codex_completion(&content), started_at: turn_started(&content, "codex") })
}

pub fn unique_codex_session_id(sessions: &Path, cwd: &str, started_at: &str, source: &str) -> Option<String> {
    let started = DateTime::parse_from_rfc3339(started_at).ok()?.with_timezone(&Utc);
    let mut matches = Vec::new();
    let files = collect_newest_jsonl_files(sessions, 5, 40, None);
    if files.len() == 40 && files.last().is_some_and(|path| touched_since(path, started)) { return None; }
    for path in files {
        if !touched_since(&path, started) { break; }
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        let Some(meta) = content.lines().next().and_then(|line| serde_json::from_str::<Value>(line).ok()) else { continue };
        let Some(payload) = meta.get("payload") else { continue };
        let Some(timestamp) = payload.get("timestamp").and_then(Value::as_str).and_then(parse_ts) else { continue };
        if !same_dir(payload.get("cwd").and_then(Value::as_str).unwrap_or(""), cwd) || timestamp < started - chrono::Duration::seconds(10) { continue; }
        matches.push((path, payload.get("id").and_then(Value::as_str).and_then(|id| uuid::Uuid::parse_str(id).ok())));
    }
    if matches.len() != 1 || matches[0].0.to_string_lossy() != source { return None; }
    matches[0].1.map(|id| id.to_string())
}

/// Antigravity: brain/<uuid>/.system_generated/logs/transcript.jsonl, 로그에 작업 폴더가 없어 시작 시각으로만 매칭
// shortcut: 로그 후보가 여러 개면 보류하며, CLI가 cwd를 기록하면 폴더로 식별한다.
fn antigravity(brain: &Path, started: DateTime<Utc>, claimed: &[String]) -> Option<ContextUsage> {
    match std::fs::read_dir(brain) {
        Ok(_) => {},
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Some(ContextUsage { tokens: 0, window: None, source: "agy:no-log".into(), completed_at: None, started_at: None }),
        Err(_) => return None,
    }
    let mut best: Option<(DateTime<Utc>, PathBuf, String)> = None;
    let mut matches = 0;
    let mut recent = 0;
    for entry in walkdir::WalkDir::new(brain).max_depth(4) {
        let entry = entry.ok()?;
        if entry.file_name() != "transcript.jsonl" { continue; }
        let metadata = std::fs::metadata(entry.path()).ok()?;
        if !metadata.is_file() { continue; }
        let modified = metadata.modified().ok()?;
        if modified < SystemTime::from(started) - Duration::from_secs(10) { continue; }
        recent += 1;
        if recent > 40 { return None; }
        let path = entry.into_path();
        let src = path.to_string_lossy().to_string();
        if claimed.contains(&src) {
            continue;
        }
        let content = std::fs::read_to_string(&path).ok()?;
        let ts = content
            .lines()
            .next()
            .and_then(|l| serde_json::from_str::<Value>(l).ok())
            .and_then(|v| v.get("created_at").and_then(|x| x.as_str()).and_then(parse_ts))?;
        if ts < started - chrono::Duration::seconds(10) {
            continue;
        }
        matches += 1;
        if best.as_ref().map(|b| ts < b.0).unwrap_or(true) {
            best = Some((ts, path, content));
        }
    }
    if matches == 0 {
        return Some(ContextUsage { tokens: 0, window: None, source: "agy:no-log".into(), completed_at: None, started_at: None });
    }
    if matches != 1 { return None; }
    let (_, path, content) = best?;
    let tokens = antigravity_last_context(&content).unwrap_or(0);
    let quiet = std::fs::metadata(&path).and_then(|m| m.modified()).ok()
        .and_then(|t| t.elapsed().ok()).is_some_and(|elapsed| elapsed >= Duration::from_secs(10));
    let (started_at, completed_at) = antigravity_turn(&content, quiet);
    Some(ContextUsage { tokens, window: None, source: path.to_string_lossy().into(), completed_at, started_at })
}

fn antigravity_turn(content: &str, quiet: bool) -> (Option<i64>, Option<i64>) {
    let mut started = None;
    let mut last = None;
    for line in content.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { return (None, None); };
        if v.get("type").and_then(Value::as_str) == Some("USER_INPUT") {
            started = v.get("created_at").and_then(Value::as_str).and_then(parse_ts).map(|t| t.timestamp_millis());
        }
        last = Some(v);
    }
    let completed = last.filter(|v| quiet && started.is_some() &&
        v.get("type").and_then(Value::as_str) == Some("PLANNER_RESPONSE") &&
        v.get("status").and_then(Value::as_str) == Some("DONE") &&
        v.get("content").and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty()) &&
        v.get("tool_calls").map_or(true, |calls| calls.as_array().is_some_and(|a| a.is_empty())))
        .and_then(|v| v.get("created_at").and_then(Value::as_str).and_then(parse_ts))
        .map(|t| t.timestamp_millis() + 999);
    (started, completed)
}

fn antigravity_last_context(content: &str) -> Option<u64> {
    content.lines().rev().find_map(|line| {
        if !line.contains("\"input_tokens\"") {
            return None;
        }
        let v: Value = serde_json::from_str(line).ok()?;
        let n = |k: &str| v.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
        let total = n("input_tokens") + n("cache_read_tokens") + n("output_tokens");
        (total > 0).then_some(total)
    })
}

/// OpenCode: opencode.db의 session(directory·time_created)으로 매칭, 마지막 assistant 메시지의 tokens.total
fn opencode(db: &Path, cwd: &str, started: DateTime<Utc>, claimed: &[String]) -> Option<ContextUsage> {
    if !db.is_file() {
        return None;
    }
    let conn = rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let since_ms = started.timestamp_millis() - 10_000;
    let mut stmt = conn
        .prepare("SELECT id, directory FROM session WHERE parent_id IS NULL AND time_created >= ?1 ORDER BY time_created ASC")
        .ok()?;
    let sessions: Vec<(String, String)> = stmt
        .query_map([since_ms], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok()?
        .flatten()
        .collect();
    let matches = sessions.iter().filter(|(_, dir)| same_dir(dir, cwd)).count();
    let (sid, _) = sessions
        .into_iter()
        .find(|(id, dir)| same_dir(dir, cwd) && !claimed.contains(&format!("opencode:{id}")))?;
    let data: String = conn
        .query_row(
            "SELECT data FROM message WHERE session_id = ?1 AND data LIKE '%\"role\":\"assistant\"%' ORDER BY time_created DESC LIMIT 1",
            [&sid],
            |r| r.get(0),
        )
        .ok()?;
    let v: Value = serde_json::from_str(&data).ok()?;
    let tokens = v.get("tokens")?.get("total")?.as_u64().filter(|t| *t > 0)?;
    let latest: Option<String> = conn.query_row(
        "SELECT data FROM message WHERE session_id = ?1 ORDER BY time_created DESC, rowid DESC LIMIT 1",
        [&sid], |r| r.get(0),
    ).ok();
    let completed_at = latest.and_then(|data| serde_json::from_str::<Value>(&data).ok()).and_then(|v| opencode_completion(&v, matches));
    Some(ContextUsage { tokens, window: None, source: format!("opencode:{sid}"), completed_at, started_at: None })
}

#[cfg(test)]
mod tests {
    #[test]
    fn claude_local_commands_preserve_a_completed_turn_but_not_a_running_turn() {
        let user = r#"{"timestamp":"2026-11-02T02:00:00Z","type":"user","message":{"content":"real request"}}"#;
        let completed = r#"{"timestamp":"2026-11-02T02:00:01Z","type":"assistant","message":{"stop_reason":"end_turn"}}"#;
        let running = r#"{"timestamp":"2026-11-02T02:00:01Z","type":"assistant","message":{"stop_reason":"tool_use"}}"#;
        let caveat = r#"{"timestamp":"2026-11-02T02:00:02Z","type":"user","isMeta":true,"message":{"content":"<local-command-caveat>"}}"#;
        let summary = r#"{"timestamp":"2026-11-02T02:00:04Z","type":"user","isCompactSummary":true,"isVisibleInTranscriptOnly":true,"message":{"content":"summary"}}"#;
        let output = r#"{"timestamp":"2026-11-02T02:00:05Z","type":"user","message":{"content":"<local-command-stdout>done"}}"#;
        let boundary = r#"{"timestamp":"2026-11-02T02:00:06Z","type":"system","subtype":"compact_boundary"}"#;
        for command in ["compact", "clear", "model"] {
            let cmd = serde_json::json!({"timestamp":"2026-11-02T02:00:03Z", "type":"user", "message":{"content":format!("<command-name>/{command}</command-name>")}}).to_string();
            let content = [user, completed, caveat, &cmd, summary, output, boundary].join("\n");
            let started = super::turn_started(&content, "claude").unwrap();
            let ended = super::claude_completion(&content).unwrap();
            assert!(started < ended);
            assert_eq!(ended, super::parse_ts("2026-11-02T02:00:05Z").unwrap().timestamp_millis());
            let active = [user, running, caveat, &cmd, summary, output, boundary].join("\n");
            assert!(super::claude_completion(&active).is_none());
        }
    }
    #[test]
    fn claude_plain_slash_entry_is_local_only_when_paired_with_command_name_and_stdout() {
        let line = |ts: &str, v: &str| format!(r#"{{"timestamp":"2026-11-02T02:{ts}Z","type":"user","message":{{"content":{}}}}}"#, serde_json::json!(v));
        let done = r#"{"timestamp":"2026-11-02T02:00:01Z","type":"assistant","message":{"stop_reason":"end_turn"}}"#;
        let boundary = r#"{"timestamp":"2026-11-02T02:00:09Z","type":"system","subtype":"compact_boundary"}"#;
        let first = line("00:00", "real request");
        let end = super::parse_ts("2026-11-02T02:00:08Z").unwrap().timestamp_millis();
        let real_cmd = |name: &str| line("00:03", &format!("<command-name>{name}</command-name>
            <command-message>{}</command-message>
            <command-args></command-args>", name.trim_start_matches('/')));
        for (plain, name) in [("/compact", "/compact"), ("/clear", "/clear"), ("/model opus", "/model")] {
            // 실제 순서: end_turn → 평문 → boundary → 요약 → caveat → command-name(+message+args) → stdout → attachment
            let summary = r#"{"timestamp":"2026-11-02T02:00:04Z","type":"user","isCompactSummary":true,"message":{"content":"summary"}}"#;
            let caveat = r#"{"timestamp":"2026-11-02T02:00:05Z","type":"user","isMeta":true,"message":{"content":"<local-command-caveat>x"}}"#;
            let attach = r#"{"timestamp":"2026-11-02T02:00:09Z","type":"attachment"}"#;
            let content = [first.clone(), done.into(), line("00:02", plain), boundary.into(), summary.into(), caveat.into(), real_cmd(name), line("00:08", "<local-command-stdout>ok"), attach.into()].join("
");
            assert_eq!(super::claude_completion(&content), Some(end), "{plain}");
            assert_eq!(super::turn_started(&content, "claude"), super::parse_ts("2026-11-02T02:00:00Z").map(|t| t.timestamp_millis()), "{plain}");
        }
        // 스킬: command-name은 있으나 stdout 없이 모델 응답 대기 → 실행 중(완료 없음)
        let skill = [first.clone(), done.into(), line("00:02", "/review"), real_cmd("/review")].join("
");
        assert!(super::claude_completion(&skill).is_none());
        // 짝 없는 "/" 프롬프트는 일반 턴 시작
        let path = [first.clone(), done.into(), line("00:02", "/usr/bin 에서 찾아줘")].join("
");
        assert!(super::claude_completion(&path).is_none());
        assert_eq!(super::turn_started(&path, "claude"), super::parse_ts("2026-11-02T02:00:02Z").map(|t| t.timestamp_millis()));
    }
    #[test]
    fn turn_start_uses_user_or_task_event_without_sidechains() {
        let codex = r#"{"timestamp":"2026-11-02T02:00:00Z","type":"event_msg","payload":{"type":"user_message"}}"#;
        let claude = r#"{"timestamp":"2026-11-02T02:00:00Z","type":"user"}"#;
        let sidechain = r#"{"timestamp":"2026-11-02T02:00:00Z","type":"user","isSidechain":true}"#;
        assert!(super::turn_started(codex, "codex").is_some());
        assert!(super::turn_started(claude, "claude").is_some());
        assert!(super::turn_started(sidechain, "claude").is_none());
    }
    use super::*;

    #[test]
    fn codex_busy_state_is_available_after_other_log_is_claimed() {
        let root = std::env::temp_dir().join(format!("agentrix-context-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let now = Utc::now();
        let timestamp = now.to_rfc3339();
        let log = format!("{}\n{}\n{}\n",
            serde_json::json!({"type":"session_meta", "payload":{"cwd":"C:/project","timestamp":timestamp}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":42}}}}),
            serde_json::json!({"timestamp":timestamp,"type":"event_msg","payload":{"type":"task_started"}}));
        let first = root.join("first.jsonl");
        let second = root.join("second.jsonl");
        std::fs::write(&first, &log).unwrap();
        std::fs::write(&second, &log).unwrap();
        assert!(codex(&root, "C:/project", now, &[]).unwrap().started_at.is_none());
        let result = codex(&root, "C:/project", now, &[first.to_string_lossy().into_owned()]).unwrap();
        assert!(result.started_at.is_some());
        assert!(result.completed_at.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn codex_resume_only_saves_unambiguous_session() {
        let root = std::env::temp_dir().join(format!("agentrix-codex-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let now = Utc::now().to_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let path = root.join(format!("rollout-{id}.jsonl"));
        let log = |id: &str| format!("{}\n{}\n", serde_json::json!({"type":"session_meta", "payload":{"id":id,"cwd":"C:/project","timestamp":now}}), serde_json::json!({"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":42}}}}));
        std::fs::write(&path, log(&id)).unwrap();
        let source = path.to_string_lossy();
        assert_eq!(unique_codex_session_id(&root, "C:/project", &now, &source), Some(id.clone()));
        assert_eq!(codex_log_for_session(&root, "C:/project", &id), Some(path.clone()));
        assert!(codex_log_for_session(&root, "C:/other", &id).is_none());
        assert!(codex_log_for_session(&root, "C:/project", "../bad").is_none());
        assert_eq!(read_codex_session(&path).unwrap().tokens, 42);
        let other = uuid::Uuid::new_v4().to_string();
        std::fs::write(root.join(format!("rollout-{other}.jsonl")), log(&other)).unwrap();
        assert!(unique_codex_session_id(&root, "C:/project", &now, &source).is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn claude_context_uses_resumed_session_log() {
        let root = std::env::temp_dir().join(format!("agentrix-context-{}", uuid::Uuid::new_v4()));
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::write(project.join(format!("{id}.jsonl")), r#"{"message":{"usage":{"input_tokens":100,"output_tokens":5}}}"#).unwrap();
        assert_eq!(claude(&root, &id).unwrap().tokens, 105);
        assert!(claude(&root, &uuid::Uuid::new_v4().to_string()).is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_finished_turns_are_idle() {
        let finished = r#"{"type":"assistant","timestamp":"2026-10-28T07:00:01Z","message":{"stop_reason":"end_turn"}}"#;
        assert!(claude_completion(finished).is_some());
        assert_eq!(claude_completion(&format!("{finished}\n{{\"type\":\"user\"}}")), None);
        assert_eq!(claude_completion(r#"{"type":"assistant","message":{"stop_reason":"tool_use"}}"#), None);
        let codex = r#"{"timestamp":"2026-10-28T07:00:01Z","payload":{"type":"task_complete"}}"#;
        assert!(codex_completion(codex).is_some());
        assert_eq!(codex_completion(&format!("{codex}\n{{\"payload\":{{\"type\":\"task_started\"}}}}")), None);
        let opencode = serde_json::json!({"role":"assistant","finish":"stop","time":{"completed":123}});
        assert_eq!(opencode_completion(&opencode, 1), Some(123));
        assert_eq!(opencode_completion(&opencode, 2), None);
        assert_eq!(opencode_completion(&serde_json::json!({"role":"assistant","finish":"tool-calls","time":{"completed":123}}), 1), None);
    }

    #[test]
    fn opencode_waits_for_latest_turn_and_unambiguous_session() {
        let path = std::env::temp_dir().join(format!("agentrix-context-{}.db", uuid::Uuid::new_v4()));
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE session (id TEXT, directory TEXT, parent_id TEXT, time_created INTEGER); CREATE TABLE message (session_id TEXT, data TEXT, time_created INTEGER);").unwrap();
        let started = Utc::now();
        conn.execute("INSERT INTO session VALUES ('one', 'C:/project', NULL, ?1)", [started.timestamp_millis()]).unwrap();
        conn.execute("INSERT INTO message VALUES ('one', ?1, 1)", [r#"{"role":"assistant","finish":"stop","time":{"completed":100},"tokens":{"total":1000}}"#]).unwrap();
        assert_eq!(opencode(&path, "C:/project", started, &[]).unwrap().completed_at, Some(100));
        conn.execute("INSERT INTO message VALUES ('one', ?1, 2)", [r#"{"role":"user"}"#]).unwrap();
        assert_eq!(opencode(&path, "C:/project", started, &[]).unwrap().completed_at, None);
        conn.execute("DELETE FROM message WHERE time_created = 2", []).unwrap();
        conn.execute("INSERT INTO session VALUES ('two', 'C:/project', NULL, ?1)", [started.timestamp_millis()]).unwrap();
        assert_eq!(opencode(&path, "C:/project", started, &[]).unwrap().completed_at, None);
        drop(conn);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn parses_last_context_per_cli() {
        let claude = r#"{"message":{"usage":{"input_tokens":2,"cache_creation_input_tokens":736,"cache_read_input_tokens":97115,"output_tokens":404}}}
{"isSidechain":true,"message":{"usage":{"input_tokens":5,"output_tokens":5}}}"#;
        assert_eq!(claude_last_context(claude), Some(98257));

        let codex = r#"{"type":"session_meta","payload":{"cwd":"C:\\p"}}
{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":20921},"model_context_window":475000}}}"#;
        assert_eq!(codex_last_context(codex), Some((20921, Some(475000))));

        let agy = r#"{"step_index":0,"type":"USER_INPUT","created_at":"2026-10-28T06:11:28Z"}
{"step_index":3,"type":"PLANNER_RESPONSE","input_tokens":8680,"cache_read_tokens":0,"output_tokens":669}"#;
        assert_eq!(antigravity_last_context(agy), Some(9349));

        assert!(same_dir("C:/Users/a/Proj/", "c:\\users\\a\\proj"));
    }
    #[test]
    fn resumed_codex_log_with_old_meta_is_found_via_saved_id_and_completion_survives_compacted() {
        let root = std::env::temp_dir().join(format!("agentrix-codex-resume-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let path = root.join(format!("rollout-{id}.jsonl"));
        let line = |ts: &str, v: serde_json::Value| format!("{}
", serde_json::json!({"timestamp": ts, "type": v["type"], "payload": v["payload"]}));
        let mut log = line("2020-01-01T00:00:00.000Z", serde_json::json!({"type":"session_meta","payload":{"id":id,"cwd":"C:/project","timestamp":"2020-01-01T00:00:00.000Z"}}));
        log += &line("2020-01-01T00:00:01.000Z", serde_json::json!({"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":7},"model_context_window":100}}}));
        log += &line("2026-11-03T07:35:53.700Z", serde_json::json!({"type":"event_msg","payload":{"type":"task_started"}}));
        log += &line("2026-11-03T07:36:14.453Z", serde_json::json!({"type":"compacted","payload":{"message":"summary"}}));
        log += &line("2026-11-03T07:36:14.486Z", serde_json::json!({"type":"event_msg","payload":{"type":"task_complete"}}));
        std::fs::write(&path, log).unwrap();
        let now = Utc::now().to_rfc3339();
        // 시작 시각 매칭으로는 첫 줄 시각이 과거라 못 찾는다(이어하기 로그가 ctx=None이던 원인)
        assert!(read_context("codex", "x", "C:/project", &now, &[]).is_none());
        // 저장 id 대체 경로: 시작 이후 갱신된 로그면 찾고, compacted 뒤 task_complete를 완료로 읽는다
        assert_eq!(saved_codex_log_in_use(&root, "C:/project", &id, &now), Some(id.clone()));
        let ctx = read_codex_session(&path).unwrap();
        assert_eq!(ctx.completed_at, Some(1793691374486));
        assert_eq!(ctx.started_at, Some(1793691353700));
        // 새 대화로 시작해 옛 로그가 시작 이후 갱신되지 않았으면 제외
        let future = (Utc::now() + chrono::Duration::hours(1)).to_rfc3339();
        assert!(saved_codex_log_in_use(&root, "C:/project", &id, &future).is_none());
        assert!(saved_codex_log_in_use(&root, "C:/other", &id, &now).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

}
