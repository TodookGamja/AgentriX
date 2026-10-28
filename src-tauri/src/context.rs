//! 세션의 실제 컨텍스트 토큰을 CLI가 남기는 로그에서 읽는다 (토큰 최적화 임계치 판단용).
//! 로그에 토큰이 없는 CLI(grok, cursor, 새로 추가한 CLI 등)는 None → 프론트가 화면 출력 기반 추정치로 대체한다.
//! 새 CLI를 정확하게 지원하려면 read_context의 match에 리더 함수 하나만 추가하면 된다.
use crate::usage::collect_newest_jsonl_files;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

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
    Some(ContextUsage { tokens, window: None, source: file.to_string_lossy().into(), completed_at: claude_completion(&content) })
}

fn claude_completion(content: &str) -> Option<i64> {
    for line in content.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v.get("isSidechain").and_then(Value::as_bool) == Some(true) { continue; }
        match v.get("type").and_then(Value::as_str) {
            Some("user") => return None,
            Some("assistant") => return (v.pointer("/message/stop_reason").and_then(Value::as_str) == Some("end_turn"))
                .then(|| v.get("timestamp").and_then(Value::as_str).and_then(parse_ts).map(|t| t.timestamp_millis())).flatten(),
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
        matches += 1;
        if claimed.contains(&src) { continue; }
        if best.as_ref().map(|b| ts < b.0).unwrap_or(true) {
            best = Some((ts, path, content));
        }
    }
    let (_, path, content) = best?;
    let (tokens, window) = codex_last_context(&content)?;
    Some(ContextUsage { tokens, window, source: path.to_string_lossy().into(), completed_at: if matches == 1 { codex_completion(&content) } else { None } })
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

/// Antigravity: brain/<uuid>/.system_generated/logs/transcript.jsonl, 로그에 작업 폴더가 없어 시작 시각으로만 매칭
// ponytail: 여러 Antigravity 세션을 거의 동시에 띄우면 뒤바뀔 수 있음, CLI가 cwd를 기록하면 Codex처럼 폴더 매칭 추가
fn antigravity(brain: &Path, started: DateTime<Utc>, claimed: &[String]) -> Option<ContextUsage> {
    let mut best: Option<(DateTime<Utc>, PathBuf, String)> = None;
    for path in collect_newest_jsonl_files(brain, 4, 40, Some("transcript.jsonl")) {
        if !touched_since(&path, started) {
            break;
        }
        let src = path.to_string_lossy().to_string();
        if claimed.contains(&src) {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        let Some(ts) = content
            .lines()
            .next()
            .and_then(|l| serde_json::from_str::<Value>(l).ok())
            .and_then(|v| v.get("created_at").and_then(|x| x.as_str()).and_then(parse_ts))
        else { continue };
        if ts < started - chrono::Duration::seconds(10) {
            continue;
        }
        if best.as_ref().map(|b| ts < b.0).unwrap_or(true) {
            best = Some((ts, path, content));
        }
    }
    let (_, path, content) = best?;
    let tokens = antigravity_last_context(&content)?;
    Some(ContextUsage { tokens, window: None, source: path.to_string_lossy().into(), completed_at: None })
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
    Some(ContextUsage { tokens, window: None, source: format!("opencode:{sid}"), completed_at })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
