use crate::db::{insert_usage_records, CliQuotaStatus, ParsedUsageRecord};
use anyhow::Result;
use chrono::{DateTime, FixedOffset, Utc};
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime};
use walkdir::WalkDir;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub fn compute_event_hash(cli_id: &str, source_file: &str, line_idx: usize, ts: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}:{}:{}", cli_id, source_file, line_idx, ts).as_bytes());
    format!("{:x}", hasher.finalize())[..32].to_string()
}

pub fn estimate_cost_usd(model: &str, input_tokens: u64, output_tokens: u64, cache_tokens: u64) -> f64 {
    let m = model.to_lowercase();
    let (in_rate, out_rate, cache_rate) = if m.contains("opus") {
        (15.0, 75.0, 1.5)
    } else if m.contains("sonnet") || m.contains("claude") {
        (3.0, 15.0, 0.3)
    } else if m.contains("haiku") {
        (0.8, 4.0, 0.08)
    } else if m.contains("codex") || m.contains("gpt") || m.contains("o3") {
        (2.5, 10.0, 0.25)
    } else if m.contains("grok") {
        (2.0, 10.0, 0.2)
    } else if m.contains("gemini") || m.contains("antigravity") || m.contains("argon") {
        (1.25, 5.0, 0.125)
    } else {
        (2.0, 8.0, 0.2)
    };

    let cost = (input_tokens as f64 * in_rate
        + output_tokens as f64 * out_rate
        + cache_tokens as f64 * cache_rate)
        / 1_000_000.0;
    (cost * 10000.0).round() / 10000.0
}

/// 최신 수정된 `.jsonl` 파일들을 수정 시각 내림차순(최신순)으로 정렬하여 반환
pub fn collect_newest_jsonl_files(
    base_dir: &Path,
    max_depth: usize,
    max_files: usize,
    exact_file_name: Option<&str>,
) -> Vec<PathBuf> {
    if !base_dir.exists() {
        return Vec::new();
    }
    let mut files: Vec<(PathBuf, SystemTime)> = Vec::new();
    for entry in WalkDir::new(base_dir)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|e| {
            // node_modules, .git 등 거대한 디렉터리는 즉시 스킵하여 프리징 방지
            let name = e.file_name().to_string_lossy();
            name != "node_modules" && name != ".git" && name != "target"
        })
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(target_name) = exact_file_name {
            if path.file_name().and_then(|n| n.to_str()) != Some(target_name) {
                continue;
            }
        } else if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        files.push((path.to_path_buf(), mtime));
    }
    files.sort_by(|a, b| b.1.cmp(&a.1));
    files.into_iter().take(max_files).map(|(p, _)| p).collect()
}

pub fn get_dynamic_kst_reset(hours: i64) -> String {
    let kst_offset = FixedOffset::east_opt(9 * 3600).unwrap();
    let target_kst = (Utc::now() + chrono::Duration::hours(hours)).with_timezone(&kst_offset);
    let now_kst = Utc::now().with_timezone(&kst_offset);
    if target_kst.date_naive() == now_kst.date_naive() {
        format!("{}", target_kst.format("%H:%M"))
    } else {
        format!("{}", target_kst.format("%m/%d %H:%M"))
    }
}

pub fn get_dynamic_kst_weekly_reset(days: i64) -> String {
    let kst_offset = FixedOffset::east_opt(9 * 3600).unwrap();
    let target_kst = (Utc::now() + chrono::Duration::days(days)).with_timezone(&kst_offset);
    format!("{}", target_kst.format("%m/%d %H:%M"))
}

pub fn format_epoch_kst(epoch_secs: i64) -> String {
    let kst_offset = FixedOffset::east_opt(9 * 3600).unwrap();
    if let Some(dt_utc) = DateTime::<Utc>::from_timestamp(epoch_secs, 0) {
        let dt_kst = dt_utc.with_timezone(&kst_offset);
        let now_kst = Utc::now().with_timezone(&kst_offset);
        if dt_kst <= now_kst {
            return String::new();
        }
        if dt_kst.date_naive() == now_kst.date_naive() {
            format!("{}", dt_kst.format("%H:%M"))
        } else {
            format!("{}", dt_kst.format("%m/%d %H:%M"))
        }
    } else {
        String::new()
    }
}

pub fn format_iso_kst(iso_str: &str) -> Option<String> {
    let parsed = DateTime::parse_from_rfc3339(iso_str).ok()?;
    let kst_offset = FixedOffset::east_opt(9 * 3600)?;
    let dt_kst = parsed.with_timezone(&kst_offset);
    let now_kst = Utc::now().with_timezone(&kst_offset);
    if dt_kst <= now_kst {
        return None;
    }
    if dt_kst.date_naive() == now_kst.date_naive() {
        Some(format!("{}", dt_kst.format("%H:%M")))
    } else {
        Some(format!("{}", dt_kst.format("%m/%d %H:%M")))
    }
}

/// 1. Claude Code 독립 로그 파서 (`~/.claude/projects/**/*.jsonl`)
pub mod claude_parser {
    use super::*;

    pub fn parse_jsonl_line(source_id: &str, line_idx: usize, line: &str) -> Option<ParsedUsageRecord> {
        let v: Value = serde_json::from_str(line.trim()).ok()?;
        let usage = v
            .get("message")
            .and_then(|m| m.get("usage"))
            .or_else(|| v.get("usage"))?;

        let input_tokens = usage.get("input_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
        let output_tokens = usage.get("output_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
        let cache_read = usage
            .get("cache_read_input_tokens")
            .and_then(|x| x.as_u64())
            .unwrap_or(0);
        let cache_create = usage
            .get("cache_creation_input_tokens")
            .and_then(|x| x.as_u64())
            .unwrap_or(0);
        let cache_tokens = cache_read + cache_create;

        if input_tokens + output_tokens + cache_tokens == 0 {
            return None;
        }

        let model_name = v
            .get("message")
            .and_then(|m| m.get("model"))
            .or_else(|| v.get("model"))
            .and_then(|m| m.as_str())
            .unwrap_or("claude-sonnet-4")
            .to_string();

        let timestamp = v
            .get("timestamp")
            .or_else(|| v.get("createdAt"))
            .and_then(|t| t.as_str())
            .map(|s| s.to_string())?;

        let cost_usd = estimate_cost_usd(&model_name, input_tokens, output_tokens, cache_tokens);
        let event_hash = compute_event_hash("claude", source_id, line_idx, &timestamp);

        Some(ParsedUsageRecord {
            event_hash,
            cli_id: "claude".into(),
            timestamp,
            model_name,
            input_tokens,
            output_tokens,
            cache_tokens,
            cost_usd,
        })
    }

    pub fn scan_dir(base_dir: &Path) -> Vec<ParsedUsageRecord> {
        let mut out = Vec::new();
        let newest_files = collect_newest_jsonl_files(base_dir, 6, 30, None);
        for path in newest_files {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let src = path.to_string_lossy().to_string();
                let all_lines: Vec<&str> = content.lines().collect();
                let start_idx = all_lines.len().saturating_sub(800);
                for (idx, line) in all_lines.into_iter().enumerate().skip(start_idx) {
                    if let Some(rec) = parse_jsonl_line(&src, idx, line) {
                        out.push(rec);
                    }
                }
            }
        }
        out
    }
}

/// 2. Codex CLI 독립 로그 파서 (`~/.codex/sessions/**/*.jsonl`)
pub mod codex_parser {
    use super::*;

    pub fn parse_jsonl_line(source_id: &str, line_idx: usize, line: &str) -> Option<ParsedUsageRecord> {
        let v: Value = serde_json::from_str(line.trim()).ok()?;
        let row_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let timestamp = v
            .get("timestamp")
            .or_else(|| v.get("created_at"))
            .and_then(|t| t.as_str())?;

        let model_name = v
            .get("model")
            .or_else(|| v.get("payload").and_then(|p| p.get("model")))
            .and_then(|m| m.as_str())
            .unwrap_or("gpt-5-codex")
            .to_string();

        if row_type == "token_usage_record" {
            let payload = v.get("payload")?;
            let usage = payload.get("usage")?;
            let raw_inp = usage.get("input_tokens").or_else(|| usage.get("prompt_tokens")).and_then(|x| x.as_u64()).unwrap_or(0);
            let cache_tokens = usage
                .get("cached_input_tokens")
                .or_else(|| usage.get("cached_tokens"))
                .and_then(|x| x.as_u64())
                .unwrap_or(0);
            let out_tokens = usage.get("output_tokens").or_else(|| usage.get("completion_tokens")).and_then(|x| x.as_u64()).unwrap_or(0);
            let input_tokens = raw_inp.saturating_sub(cache_tokens);

            if input_tokens + out_tokens + cache_tokens == 0 {
                return None;
            }

            let turn_id = payload
                .get("turn_id")
                .or_else(|| payload.get("response_id"))
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let event_hash = if !turn_id.is_empty() {
                compute_event_hash("codex", source_id, 0, turn_id)
            } else {
                compute_event_hash("codex", source_id, line_idx, timestamp)
            };

            let cost_usd = estimate_cost_usd(&model_name, input_tokens, out_tokens, cache_tokens);
            Some(ParsedUsageRecord {
                event_hash,
                cli_id: "codex".into(),
                timestamp: timestamp.to_string(),
                model_name,
                input_tokens,
                output_tokens: out_tokens,
                cache_tokens,
                cost_usd,
            })
        } else {
            let usage = v
                .get("usage")
                .or_else(|| v.get("payload").and_then(|p| p.get("usage")))
                .or_else(|| {
                    v.get("payload")
                        .and_then(|p| p.get("info"))
                        .and_then(|i| i.get("last_token_usage"))
                })?;

            let raw_inp = usage.get("input_tokens").or_else(|| usage.get("prompt_tokens")).and_then(|x| x.as_u64()).unwrap_or(0);
            let cache_tokens = usage
                .get("cached_tokens")
                .or_else(|| usage.get("cached_input_tokens"))
                .and_then(|x| x.as_u64())
                .unwrap_or(0);
            let out_tokens = usage.get("output_tokens").or_else(|| usage.get("completion_tokens")).and_then(|x| x.as_u64()).unwrap_or(0);
            let input_tokens = raw_inp.saturating_sub(cache_tokens);

            if input_tokens + out_tokens + cache_tokens == 0 {
                return None;
            }

            let dedup_idx = v
                .get("payload")
                .and_then(|p| p.get("info"))
                .and_then(|i| i.get("total_token_usage"))
                .and_then(|t| t.get("total_tokens"))
                .and_then(|x| x.as_u64())
                .map(|tot| tot as usize)
                .unwrap_or(line_idx);

            let event_hash = compute_event_hash("codex", source_id, dedup_idx, timestamp);
            let cost_usd = estimate_cost_usd(&model_name, input_tokens, out_tokens, cache_tokens);
            Some(ParsedUsageRecord {
                event_hash,
                cli_id: "codex".into(),
                timestamp: timestamp.to_string(),
                model_name,
                input_tokens,
                output_tokens: out_tokens,
                cache_tokens,
                cost_usd,
            })
        }
    }

    pub fn scan_dir(base_dir: &Path) -> Vec<ParsedUsageRecord> {
        let mut out = Vec::new();
        let newest_files = collect_newest_jsonl_files(base_dir, 8, 30, None);
        for path in newest_files {
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let src = path.to_string_lossy().to_string();
            let all_lines: Vec<&str> = content.lines().collect();

            // 1) turn_context에서 실제 세션 사용 모델 추출 (예: gpt-6.1-sol, gpt-5-codex)
            let mut detected_model = "gpt-5-codex".to_string();
            for line in all_lines.iter().rev() {
                if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                    if v.get("type").and_then(|t| t.as_str()) == Some("turn_context") {
                        if let Some(m) = v.get("payload").and_then(|p| p.get("model")).and_then(|m| m.as_str()) {
                            detected_model = m.to_string();
                            break;
                        }
                    }
                }
            }

            // 2) 파일에 공식 턴별 토큰 사용 기록인 `token_usage_record`가 존재하는지 확인
            let has_usage_records = all_lines.iter().any(|l| l.contains("\"token_usage_record\""));

            let start_idx = all_lines.len().saturating_sub(1000);
            for (idx, line) in all_lines.into_iter().enumerate().skip(start_idx) {
                let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
                    continue;
                };
                let row_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                let timestamp = v.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
                if timestamp.is_empty() {
                    continue;
                }

                if has_usage_records {
                    // 공식 턴별 token_usage_record만 파싱 (event_msg 중복 합산 방지)
                    if row_type != "token_usage_record" {
                        continue;
                    }
                    let payload = match v.get("payload") {
                        Some(p) => p,
                        None => continue,
                    };
                    let usage = match payload.get("usage") {
                        Some(u) => u,
                        None => continue,
                    };
                    let raw_inp = usage.get("input_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
                    let cache_tokens = usage
                        .get("cached_input_tokens")
                        .or_else(|| usage.get("cached_tokens"))
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    let out_tokens = usage.get("output_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
                    let input_tokens = raw_inp.saturating_sub(cache_tokens);

                    if input_tokens + out_tokens + cache_tokens == 0 {
                        continue;
                    }

                    let turn_id = payload
                        .get("turn_id")
                        .or_else(|| payload.get("response_id"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    let event_hash = if !turn_id.is_empty() {
                        compute_event_hash("codex", &src, 0, turn_id)
                    } else {
                        compute_event_hash("codex", &src, idx, timestamp)
                    };

                    let cost_usd = estimate_cost_usd(&detected_model, input_tokens, out_tokens, cache_tokens);
                    out.push(ParsedUsageRecord {
                        event_hash,
                        cli_id: "codex".into(),
                        timestamp: timestamp.to_string(),
                        model_name: detected_model.clone(),
                        input_tokens,
                        output_tokens: out_tokens,
                        cache_tokens,
                        cost_usd,
                    });
                } else {
                    // 구버전 파일 폴백: event_msg token_count 파싱 (마지막 턴 델타만)
                    if row_type != "event_msg" {
                        continue;
                    }
                    let payload = match v.get("payload") {
                        Some(p) => p,
                        None => continue,
                    };
                    if payload.get("type").and_then(|t| t.as_str()) != Some("token_count") {
                        continue;
                    }
                    let info = match payload.get("info") {
                        Some(i) => i,
                        None => continue,
                    };
                    let last = match info.get("last_token_usage") {
                        Some(l) => l,
                        None => continue,
                    };
                    let raw_inp = last.get("input_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
                    let cache_tokens = last.get("cached_input_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
                    let out_tokens = last.get("output_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
                    let input_tokens = raw_inp.saturating_sub(cache_tokens);

                    if input_tokens + out_tokens + cache_tokens == 0 {
                        continue;
                    }

                    let total_tok = info
                        .get("total_token_usage")
                        .and_then(|t| t.get("total_tokens"))
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    let event_hash = compute_event_hash("codex", &src, total_tok as usize, "codex_turn_tot");
                    let cost_usd = estimate_cost_usd(&detected_model, input_tokens, out_tokens, cache_tokens);

                    out.push(ParsedUsageRecord {
                        event_hash,
                        cli_id: "codex".into(),
                        timestamp: timestamp.to_string(),
                        model_name: detected_model.clone(),
                        input_tokens,
                        output_tokens: out_tokens,
                        cache_tokens,
                        cost_usd,
                    });
                }
            }
        }
        out
    }
}

/// 3. Antigravity (agy) 독립 로그 파서 (`~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl`)
pub mod antigravity_parser {
    use super::*;

    pub fn parse_jsonl_line(
        source_id: &str,
        line_idx: usize,
        line: &str,
        detected_model: &str,
    ) -> Option<ParsedUsageRecord> {
        let v: Value = serde_json::from_str(line.trim()).ok()?;
        let step_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        // 오직 실제 LLM이 실행되어 토큰 지표가 기록되는 PLANNER_RESPONSE만 집계 (임의의 USER_INPUT 추정 제외)
        if step_type != "PLANNER_RESPONSE" {
            return None;
        }

        let input_tokens = v.get("input_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
        let output_tokens = v.get("output_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
        let cache_tokens = v
            .get("cache_read_tokens")
            .or_else(|| v.get("cache_tokens"))
            .and_then(|x| x.as_u64())
            .unwrap_or(0);

        let timestamp = v
            .get("created_at")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string())?;

        let (inp, out, cache) = if input_tokens + output_tokens + cache_tokens > 0 {
            (input_tokens, output_tokens, cache_tokens)
        } else {
            // 토큰 필드가 아직 기록되지 않은 경우의 최소 추정
            let content_len = v.get("content").and_then(|c| c.as_str()).map(|s| s.len()).unwrap_or(0);
            let thinking_len = v.get("thinking").and_then(|c| c.as_str()).map(|s| s.len()).unwrap_or(0);
            let tools_len = v.get("tool_calls").map(|tc| tc.to_string().len()).unwrap_or(0);
            let out_est = ((content_len + thinking_len + tools_len) / 4).max(60) as u64;
            (400u64, out_est, 800u64)
        };

        let model_name = v
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or(detected_model)
            .to_string();

        let cost_usd = estimate_cost_usd(&model_name, inp, out, cache);
        let event_hash = compute_event_hash("antigravity", source_id, line_idx, &timestamp);

        Some(ParsedUsageRecord {
            event_hash,
            cli_id: "antigravity".into(),
            timestamp,
            model_name,
            input_tokens: inp,
            output_tokens: out,
            cache_tokens: cache,
            cost_usd,
        })
    }

    pub fn scan_dir(base_dir: &Path) -> Vec<ParsedUsageRecord> {
        let mut out = Vec::new();
        if !base_dir.exists() {
            return out;
        }

        let mut candidates = Vec::new();
        if let Ok(entries) = std::fs::read_dir(base_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let transcript = p.join(".system_generated").join("logs").join("transcript.jsonl");
                    if transcript.is_file() {
                        let mtime = transcript
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .unwrap_or(SystemTime::UNIX_EPOCH);
                        candidates.push((transcript, mtime));
                    }
                }
            }
        }

        candidates.sort_by(|a, b| b.1.cmp(&a.1));

        for (path, _) in candidates.into_iter().take(25) {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let src = path.to_string_lossy().to_string();
                let all_lines: Vec<&str> = content.lines().collect();

                // 트랜스크립트 초반에서 실제 선택된 모델 감지
                let mut detected = "gemini-2.5-pro".to_string();
                for line in all_lines.iter().take(15) {
                    if line.contains("Gemini 4 Argon") || line.contains("gemini-4-argon") {
                        detected = "gemini-4-argon".to_string();
                        break;
                    } else if line.contains("Gemini 3.8 Flash") || line.contains("gemini-3.8-flash") {
                        detected = "gemini-3.8-flash".to_string();
                        break;
                    }
                }

                let start_idx = all_lines.len().saturating_sub(600);
                for (idx, line) in all_lines.into_iter().enumerate().skip(start_idx) {
                    if let Some(rec) = parse_jsonl_line(&src, idx, line, &detected) {
                        out.push(rec);
                    }
                }
            }
        }
        out
    }
}

/// 4. Grok CLI 독립 로그 파서 (`~/.grok/sessions/**/chat_history.jsonl` & `summary.json`)
pub mod grok_parser {
    use super::*;

    pub fn scan_dir(base_dir: &Path) -> Vec<ParsedUsageRecord> {
        let mut out = Vec::new();
        let home = crate::cli::home_dir();
        let sessions_dir = if base_dir.exists() {
            base_dir.to_path_buf()
        } else {
            home.join(".grok").join("sessions")
        };
        if !sessions_dir.exists() {
            return out;
        }
        let newest_files = collect_newest_jsonl_files(&sessions_dir, 6, 20, Some("chat_history.jsonl"));
        for path in newest_files {
            let summary_path = path.parent().map(|p| p.join("summary.json"));
            let (model_name, fallback_ts) = summary_path
                .and_then(|sp| std::fs::read_to_string(sp).ok())
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .map(|v| {
                    let m = v
                        .get("current_model_id")
                        .and_then(|x| x.as_str())
                        .unwrap_or("grok-4.6")
                        .to_string();
                    let ts = v
                        .get("updated_at")
                        .or_else(|| v.get("created_at"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    (m, ts)
                })
                .unwrap_or_else(|| ("grok-4.6".to_string(), String::new()));

            if fallback_ts.is_empty() {
                continue;
            }

            if let Ok(content) = std::fs::read_to_string(&path) {
                let src = path.to_string_lossy().to_string();
                let all_lines: Vec<&str> = content.lines().collect();
                let start_idx = all_lines.len().saturating_sub(200);
                for (idx, line) in all_lines.into_iter().enumerate().skip(start_idx) {
                    if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                        let role = v.get("type").or_else(|| v.get("role")).and_then(|r| r.as_str()).unwrap_or("");
                        if role == "system" {
                            continue;
                        }
                        let text_len = line.len();
                        let (inp, out_tok, cache) = if role == "user" {
                            (((text_len / 4).max(40)) as u64, 0, 200)
                        } else {
                            (180, ((text_len / 4).max(60)) as u64, 600)
                        };
                        let cost_usd = estimate_cost_usd(&model_name, inp, out_tok, cache);
                        let event_hash = compute_event_hash("grok", &src, idx, &fallback_ts);
                        out.push(ParsedUsageRecord {
                            event_hash,
                            cli_id: "grok".into(),
                            timestamp: fallback_ts.clone(),
                            model_name: model_name.clone(),
                            input_tokens: inp,
                            output_tokens: out_tok,
                            cache_tokens: cache,
                            cost_usd,
                        });
                    }
                }
            }
        }
        out
    }
}

/// 5. Cursor CLI 독립 로그 파서
pub mod cursor_parser {
    use super::*;

    pub fn parse_jsonl_line(source_id: &str, line_idx: usize, line: &str) -> Option<ParsedUsageRecord> {
        let v: Value = serde_json::from_str(line.trim()).ok()?;
        let input_tokens = v
            .get("inputTokens")
            .or_else(|| v.get("input_tokens"))
            .and_then(|x| x.as_u64())
            .unwrap_or(0);
        let output_tokens = v
            .get("outputTokens")
            .or_else(|| v.get("output_tokens"))
            .and_then(|x| x.as_u64())
            .unwrap_or(0);
        let cache_tokens = v
            .get("cacheTokens")
            .or_else(|| v.get("cache_tokens"))
            .and_then(|x| x.as_u64())
            .unwrap_or(0);

        if input_tokens + output_tokens + cache_tokens == 0 {
            return None;
        }

        let model_name = v
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("cursor-claude-sonnet")
            .to_string();

        let timestamp = v
            .get("timestamp")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string())?;

        let cost_usd = estimate_cost_usd(&model_name, input_tokens, output_tokens, cache_tokens);
        let event_hash = compute_event_hash("cursor", source_id, line_idx, &timestamp);

        Some(ParsedUsageRecord {
            event_hash,
            cli_id: "cursor".into(),
            timestamp,
            model_name,
            input_tokens,
            output_tokens,
            cache_tokens,
            cost_usd,
        })
    }

    pub fn scan_dir(base_dir: &Path) -> Vec<ParsedUsageRecord> {
        let mut out = Vec::new();
        let newest_files = collect_newest_jsonl_files(base_dir, 4, 20, None);
        for path in newest_files {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let src = path.to_string_lossy().to_string();
                let all_lines: Vec<&str> = content.lines().collect();
                let start_idx = all_lines.len().saturating_sub(300);
                for (idx, line) in all_lines.into_iter().enumerate().skip(start_idx) {
                    if let Some(rec) = parse_jsonl_line(&src, idx, line) {
                        out.push(rec);
                    }
                }
            }
        }
        out
    }
}

// ============================================================================
// 공식 Rate-Limit / Quota 실시간 추출기 (Codex / Claude / Grok)
// ============================================================================

/// Codex CLI의 최신 세션 로그(`~/.codex/sessions/**/*.jsonl`)에서
/// OpenAI 서버가 내려준 공식 `rate_limits` (`primary` 5시간 / `secondary` 주간) 및 `usage_limit_exceeded` 상태를 추출
static CODEX_QUOTA_CACHE: OnceLock<Mutex<Option<(Instant, CliQuotaStatus)>>> = OnceLock::new();

/// `~/.codex/auth.json` 토큰으로 ChatGPT 공식 사용량 API(`/backend-api/wham/usage`)를 실시간 조회
/// (세션 로그는 Codex를 실행해야만 갱신되므로 로그만 보면 수치가 멈춰 있음)
fn fetch_codex_quota_live() -> Option<CliQuotaStatus> {
    let raw = std::fs::read_to_string(crate::cli::home_dir().join(".codex").join("auth.json")).ok()?;
    let auth: Value = serde_json::from_str(&raw).ok()?;
    let tokens = auth.get("tokens")?;
    let token = tokens.get("access_token")?.as_str()?;
    let account = tokens.get("account_id").and_then(|a| a.as_str()).unwrap_or("");
    let v: Value = ureq::get("https://chatgpt.com/backend-api/wham/usage")
        .set("Authorization", &format!("Bearer {}", token))
        .set("ChatGPT-Account-Id", account)
        .set("User-Agent", "codex-cli")
        .timeout(std::time::Duration::from_secs(4))
        .call()
        .ok()?
        .into_json()
        .ok()?;
    let rl = v.get("rate_limit")?;
    let win = |k: &str| -> (f64, Option<String>) {
        let w = rl.get(k);
        let used = w.and_then(|w| w.get("used_percent")).and_then(|u| u.as_f64()).unwrap_or(0.0).clamp(0.0, 100.0);
        let reset = w
            .and_then(|w| w.get("reset_at"))
            .and_then(|r| r.as_i64())
            .map(format_epoch_kst)
            .filter(|s| !s.is_empty());
        (used.round(), reset)
    };
    let (used_5h, reset_5h) = win("primary_window");
    let (used_wk, reset_wk) = win("secondary_window");
    let plan = match v.get("plan_type").and_then(|p| p.as_str()).unwrap_or("plus") {
        "pro" => "ChatGPT Pro".to_string(),
        "plus" => "ChatGPT Plus".to_string(),
        "team" => "ChatGPT Team".to_string(),
        other => format!("ChatGPT {}", other.to_uppercase()),
    };
    let limit_reached = rl.get("limit_reached").and_then(|b| b.as_bool()).unwrap_or(false);
    Some(CliQuotaStatus {
        cli_id: "codex".into(),
        cli_name: "Codex CLI".into(),
        plan_label: plan,
        source_label: "OpenAI 쿼터 연동".into(),
        has_official_quota: true,
        used_percent_5h: used_5h,
        remaining_percent_5h: 100.0 - used_5h,
        resets_at_5h: reset_5h,
        used_percent_weekly: used_wk,
        remaining_percent_weekly: 100.0 - used_wk,
        resets_at_weekly: reset_wk,
        status_message: if limit_reached { Some("사용 한도 도달".into()) } else { None },
        sub_groups: None,
    })
}

pub fn extract_codex_quota() -> CliQuotaStatus {
    let cache = CODEX_QUOTA_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some((at, cached)) = guard.as_ref() {
            if at.elapsed().as_secs() < 60 {
                return cached.clone();
            }
        }
    }
    if let Some(live) = fetch_codex_quota_live() {
        if let Ok(mut guard) = cache.lock() {
            *guard = Some((Instant::now(), live.clone()));
        }
        return live;
    }
    extract_codex_quota_from_logs()
}

fn extract_codex_quota_from_logs() -> CliQuotaStatus {
    let home = crate::cli::home_dir();
    let sessions_dir = home.join(".codex").join("sessions");
    let newest_files = collect_newest_jsonl_files(&sessions_dir, 8, 8, None);
    let now_epoch = Utc::now().timestamp();

    for path in newest_files {
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let mut hit_limit_exceeded = false;
        let mut limit_err_msg: Option<String> = None;

        for line in content.lines().rev().take(400) {
            let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            let payload = match v.get("payload") {
                Some(p) => p,
                None => continue,
            };

            // 1) task_complete의 usage_limit_exceeded 에러 감지
            if let Some(err) = payload.get("error") {
                if err.get("codex_error_info").and_then(|c| c.as_str()) == Some("usage_limit_exceeded") {
                    hit_limit_exceeded = true;
                    limit_err_msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string());
                }
            }

            // 2) token_count의 공식 rate_limits 객체 감지
            if let Some(rl) = payload.get("rate_limits") {
                if rl.is_null() {
                    continue;
                }
                let plan_raw = rl
                    .get("plan_type")
                    .and_then(|p| p.as_str())
                    .unwrap_or("plus");
                let plan_label = match plan_raw.to_lowercase().as_str() {
                    "pro" => "ChatGPT Pro".to_string(),
                    "plus" => "ChatGPT Plus".to_string(),
                    "team" => "ChatGPT Team".to_string(),
                    other => format!("ChatGPT {}", other.to_uppercase()),
                };

                let primary = rl.get("primary");
                let secondary = rl.get("secondary");

                let raw_used_5h = primary
                    .and_then(|p| p.get("used_percent"))
                    .and_then(|x| x.as_f64())
                    .unwrap_or(0.0);
                let resets_5h_epoch = primary
                    .and_then(|p| p.get("resets_at"))
                    .and_then(|x| x.as_i64());

                let (used_5h, resets_5h_label, status_msg) = match resets_5h_epoch {
                    Some(ts) if now_epoch >= ts => (
                        0.0,
                        None,
                        None,
                    ),
                    Some(ts) => {
                        let effective_used = if hit_limit_exceeded || raw_used_5h >= 99.0 && hit_limit_exceeded {
                            100.0
                        } else if hit_limit_exceeded {
                            100.0
                        } else {
                            raw_used_5h.clamp(0.0, 100.0)
                        };
                        let msg = if effective_used >= 100.0 {
                            Some(
                                limit_err_msg.unwrap_or_else(|| {
                                    format!("5시간 사용 한도 100% 도달 ({})", format_epoch_kst(ts))
                                }),
                            )
                        } else {
                            None
                        };
                        let label = format_epoch_kst(ts);
                        (effective_used, if label.is_empty() { None } else { Some(label) }, msg)
                    }
                    None => {
                        let effective_used = if hit_limit_exceeded { 100.0 } else { raw_used_5h.clamp(0.0, 100.0) };
                        (effective_used, None, limit_err_msg)
                    }
                };

                let raw_used_weekly = secondary
                    .and_then(|s| s.get("used_percent"))
                    .and_then(|x| x.as_f64())
                    .unwrap_or(0.0);
                let resets_weekly_epoch = secondary
                    .and_then(|s| s.get("resets_at"))
                    .and_then(|x| x.as_i64());

                let (used_weekly, resets_weekly_label) = match resets_weekly_epoch {
                    Some(ts) if now_epoch >= ts => (0.0, None),
                    Some(ts) => {
                        let label = format_epoch_kst(ts);
                        (raw_used_weekly.clamp(0.0, 100.0), if label.is_empty() { None } else { Some(label) })
                    }
                    None => (raw_used_weekly.clamp(0.0, 100.0), None),
                };

                return CliQuotaStatus {
                    cli_id: "codex".into(),
                    cli_name: "Codex CLI".into(),
                    plan_label,
                    source_label: "OpenAI 쿼터 연동".into(),
                    has_official_quota: true,
                    used_percent_5h: used_5h.round(),
                    remaining_percent_5h: (100.0 - used_5h.round()).clamp(0.0, 100.0),
                    resets_at_5h: resets_5h_label,
                    used_percent_weekly: used_weekly.round(),
                    remaining_percent_weekly: (100.0 - used_weekly.round()).clamp(0.0, 100.0),
                    resets_at_weekly: resets_weekly_label,
                    status_message: status_msg,
                    sub_groups: None,
                };
            }
        }
    }

    CliQuotaStatus {
        cli_id: "codex".into(),
        cli_name: "Codex CLI".into(),
        plan_label: "ChatGPT Plus/Pro".into(),
        source_label: "로컬 세션 로그".into(),
        has_official_quota: false,
        used_percent_5h: 0.0,
        remaining_percent_5h: 100.0,
        resets_at_5h: None,
        used_percent_weekly: 0.0,
        remaining_percent_weekly: 100.0,
        resets_at_weekly: None,
        status_message: None,
        sub_groups: None,
    }
}

static CLAUDE_QUOTA_CACHE: OnceLock<Mutex<Option<(Instant, CliQuotaStatus)>>> = OnceLock::new();
static CLAUDE_QUOTA_FETCHING: OnceLock<Mutex<bool>> = OnceLock::new();

fn fetch_claude_quota_worker() -> Option<CliQuotaStatus> {
    let home = crate::cli::home_dir();
    let creds_path = home.join(".claude").join(".credentials.json");
    let mut plan_label = "Claude Pro".to_string();
    let mut access_token: Option<String> = None;

    if let Ok(raw) = std::fs::read_to_string(&creds_path) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            if let Some(oauth) = v.get("claudeAiOauth") {
                if let Some(sub) = oauth.get("subscriptionType").and_then(|s| s.as_str()) {
                    plan_label = match sub.to_lowercase().as_str() {
                        "max" => "Claude Max".to_string(),
                        "pro" => "Claude Pro".to_string(),
                        "team" => "Claude Team".to_string(),
                        other => format!("Claude {}", other.to_uppercase()),
                    };
                }
                access_token = oauth
                    .get("accessToken")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());
            }
        }
    }

    if let Some(token) = access_token {
        // curl.exe 자식 프로세스 실행 대신 ureq를 통해 메모리 상에서 직접 HTTPS 요청 수행 (콘솔 창 팝업 100% 원천 차단)
        let resp = ureq::get("https://api.anthropic.com/api/oauth/usage")
            .set("Authorization", &format!("Bearer {}", token))
            .set("anthropic-beta", "oauth-2025-04-20")
            .timeout(std::time::Duration::from_secs(4))
            .call();

        if let Ok(response) = resp {
            if let Ok(resp) = response.into_json::<Value>() {
                if resp.get("five_hour").is_some() || resp.get("seven_day").is_some() {
                    let used_5h: f64 = resp
                        .get("five_hour")
                        .and_then(|f| f.get("utilization"))
                        .and_then(|u| u.as_f64())
                        .unwrap_or(0.0)
                        .clamp(0.0, 100.0)
                        .round();
                    let resets_5h = resp
                        .get("five_hour")
                        .and_then(|f| f.get("resets_at"))
                        .and_then(|r| r.as_str())
                        .and_then(format_iso_kst);

                    let used_weekly: f64 = resp
                        .get("seven_day")
                        .and_then(|s| s.get("utilization"))
                        .and_then(|u| u.as_f64())
                        .unwrap_or(0.0)
                        .clamp(0.0, 100.0)
                        .round();
                    let resets_weekly = resp
                        .get("seven_day")
                        .and_then(|s| s.get("resets_at"))
                        .and_then(|r| r.as_str())
                        .and_then(format_iso_kst);

                    let result = CliQuotaStatus {
                        cli_id: "claude".into(),
                        cli_name: "Claude Code".into(),
                        plan_label,
                        source_label: "Anthropic 연동".into(),
                        has_official_quota: true,
                        used_percent_5h: used_5h,
                        remaining_percent_5h: (100.0f64 - used_5h).clamp(0.0f64, 100.0f64),
                        resets_at_5h: resets_5h,
                        used_percent_weekly: used_weekly,
                        remaining_percent_weekly: (100.0f64 - used_weekly).clamp(0.0f64, 100.0f64),
                        resets_at_weekly: resets_weekly,
                        status_message: None,
                        sub_groups: None,
                    };
                    let cache_mutex = CLAUDE_QUOTA_CACHE.get_or_init(|| Mutex::new(None));
                    if let Ok(mut guard) = cache_mutex.lock() {
                        *guard = Some((Instant::now(), result.clone()));
                    }
                    save_claude_cache_to_disk(&result);
                    return Some(result);
                }
            }
        }
    }
    None
}

fn get_claude_cache_file() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AI_CLI_Manager")
        .join("claude_quota_cache.json")
}

fn save_claude_cache_to_disk(quota: &CliQuotaStatus) {
    let p = get_claude_cache_file();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(quota) {
        let _ = std::fs::write(p, json);
    }
}

fn load_claude_cache_from_disk() -> Option<CliQuotaStatus> {
    let p = get_claude_cache_file();
    if p.is_file() {
        if let Ok(metadata) = p.metadata() {
            if let Ok(modified) = metadata.modified() {
                if let Ok(elapsed) = modified.elapsed() {
                    if elapsed.as_secs() > 300 {
                        let _ = std::fs::remove_file(&p);
                        return None;
                    }
                }
            }
        }
        if let Ok(content) = std::fs::read_to_string(&p) {
            if let Ok(quota) = serde_json::from_str::<CliQuotaStatus>(&content) {
                if quota.has_official_quota && quota.resets_at_5h.is_some() {
                    return Some(quota);
                }
            }
        }
    }
    None
}

/// Claude Code의 `~/.claude/.credentials.json` OAuth 토큰으로
/// Anthropic 공식 `https://api.anthropic.com/api/oauth/usage` 엔드포인트에서 실시간 5시간/주간 사용률을 조회
pub fn extract_claude_quota(force_refresh: bool) -> CliQuotaStatus {
    let cache_mutex = CLAUDE_QUOTA_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache_mutex.lock() {
        if let Some((fetched_at, cached)) = guard.as_ref() {
            if !force_refresh && fetched_at.elapsed().as_secs() < 60 {
                return cached.clone();
            }
        }
    }

    if force_refresh {
        if let Some(res) = fetch_claude_quota_worker() {
            return res;
        }
    } else {
        let fetching_mutex = CLAUDE_QUOTA_FETCHING.get_or_init(|| Mutex::new(false));
        if let Ok(mut is_fetching) = fetching_mutex.lock() {
            if !*is_fetching {
                *is_fetching = true;
                std::thread::spawn(move || {
                    fetch_claude_quota_worker();
                    if let Ok(mut flag) = CLAUDE_QUOTA_FETCHING.get().unwrap().lock() {
                        *flag = false;
                    }
                });
            }
        }
    }

    if let Ok(guard) = cache_mutex.lock() {
        if let Some((_, cached)) = guard.as_ref() {
            return cached.clone();
        }
    }

    // 디스크에 영구 캐시된 직전 공식 쿼터 즉시 복원 (앱 실행 시 0ms 즉각 렌더링)
    if let Some(disk_cached) = load_claude_cache_from_disk() {
        if let Ok(mut guard) = cache_mutex.lock() {
            *guard = Some((Instant::now(), disk_cached.clone()));
        }
        return disk_cached;
    }

    // 조회 전/실패 시 가짜 수치를 만들지 않고 "조회 중" 상태만 반환 (디스크 캐시에도 저장하지 않음)
    unavailable_quota("claude", "Claude Code", "Claude Pro", "Anthropic 연동", "공식 쿼터 조회 중…")
}

fn unavailable_quota(id: &str, name: &str, plan: &str, source: &str, msg: &str) -> CliQuotaStatus {
    CliQuotaStatus {
        cli_id: id.into(),
        cli_name: name.into(),
        plan_label: plan.into(),
        source_label: source.into(),
        has_official_quota: false,
        used_percent_5h: 0.0,
        remaining_percent_5h: 100.0,
        resets_at_5h: None,
        used_percent_weekly: 0.0,
        remaining_percent_weekly: 100.0,
        resets_at_weekly: None,
        status_message: Some(msg.into()),
        sub_groups: None,
    }
}

/// Grok CLI의 `~/.grok/logs/unified.jsonl`에서
/// xAI 공식 `billing: fetched credits config` (`creditUsagePercent`, `subscriptionTier`, `currentPeriod.end`)를 추출
static GROK_QUOTA_CACHE: OnceLock<Mutex<Option<(Instant, CliQuotaStatus)>>> = OnceLock::new();

fn read_grok_auth() -> Option<(String, String, String)> {
    let raw = std::fs::read_to_string(crate::cli::home_dir().join(".grok").join("auth.json")).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let e = v.as_object()?.values().next()?;
    Some((
        e.get("key")?.as_str()?.to_string(),
        e.get("user_id")?.as_str()?.to_string(),
        e.get("expires_at")?.as_str()?.to_string(),
    ))
}

/// Grok CLI가 시작 시 호출하는 xAI 공식 크레딧 API(`/v1/billing?format=credits`) 실시간 조회
fn fetch_grok_quota_live() -> Option<CliQuotaStatus> {
    let (mut key, mut user_id, expires_at) = read_grok_auth()?;
    if rfc3339_expired(&expires_at) {
        // 만료 시 grok 자체 갱신 로직을 태운다 (`grok models`: 모델 호출 없이 토큰만 갱신·저장)
        run_cli_silently(&crate::cli::home_dir().join(".grok").join("bin").join("grok.exe"), &["models"]);
        (key, user_id, _) = read_grok_auth()?;
    }
    let v: Value = ureq::get("https://cli-chat-proxy.grok.com/v1/billing?format=credits")
        .set("Authorization", &format!("Bearer {}", key))
        .set("x-userid", &user_id)
        .set("User-Agent", "grok-cli")
        .timeout(std::time::Duration::from_secs(5))
        .call()
        .ok()?
        .into_json()
        .ok()?;
    let cfg = v.get("config")?;
    let used = cfg.get("creditUsagePercent").and_then(|p| p.as_f64()).unwrap_or(0.0).clamp(0.0, 100.0).round();
    let end = cfg
        .get("currentPeriod")
        .and_then(|cp| cp.get("end"))
        .or_else(|| cfg.get("billingPeriodEnd"))
        .and_then(|e| e.as_str())
        .and_then(format_iso_kst);
    Some(CliQuotaStatus {
        cli_id: "grok".into(),
        cli_name: "Grok CLI".into(),
        plan_label: "SuperGrok".into(),
        source_label: "xAI 크레딧 연동".into(),
        has_official_quota: true,
        used_percent_5h: used,
        remaining_percent_5h: 100.0 - used,
        resets_at_5h: end.clone().map(|s| format!("통합 주간 크레딧 ({})", s)),
        used_percent_weekly: used,
        remaining_percent_weekly: 100.0 - used,
        resets_at_weekly: end,
        status_message: None,
        sub_groups: None,
    })
}

pub fn extract_grok_quota() -> CliQuotaStatus {
    let cache = GROK_QUOTA_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some((at, cached)) = guard.as_ref() {
            if at.elapsed().as_secs() < 60 {
                return cached.clone();
            }
        }
    }
    if let Some(live) = fetch_grok_quota_live() {
        if let Ok(mut guard) = cache.lock() {
            *guard = Some((Instant::now(), live.clone()));
        }
        return live;
    }
    extract_grok_quota_from_logs()
}

fn extract_grok_quota_from_logs() -> CliQuotaStatus {
    let home = crate::cli::home_dir();
    let unified_log = home.join(".grok").join("logs").join("unified.jsonl");
    if let Ok(content) = std::fs::read_to_string(&unified_log) {
        for line in content.lines().rev().take(500) {
            if !line.contains("fetched credits config") {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                if let Some(ctx) = v.get("ctx") {
                    let tier = ctx
                        .get("subscriptionTier")
                        .and_then(|t| t.as_str())
                        .unwrap_or("SuperGrok")
                        .to_string();
                    if let Some(cfg) = ctx.get("config") {
                        let used_pct = cfg
                            .get("creditUsagePercent")
                            .and_then(|p| p.as_f64())
                            .unwrap_or(0.0)
                            .clamp(0.0, 100.0)
                            .round();
                        let end_raw = cfg
                            .get("currentPeriod")
                            .and_then(|cp| cp.get("end"))
                            .or_else(|| cfg.get("billingPeriodEnd"))
                            .and_then(|e| e.as_str());
                        let end_iso = end_raw.and_then(format_iso_kst);
                        // 로그는 grok 실행 시에만 기록됨: 마지막 기록의 기간이 이미 끝났다면 리셋된 것으로 표시
                        let period_over = end_raw.is_some() && end_iso.is_none();
                        let used_pct = if period_over { 0.0 } else { used_pct };
                        let remain_pct = (100.0 - used_pct).clamp(0.0, 100.0);

                        return CliQuotaStatus {
                            cli_id: "grok".into(),
                            cli_name: "Grok CLI".into(),
                            plan_label: tier,
                            source_label: "xAI 크레딧 연동".into(),
                            has_official_quota: true,
                            used_percent_5h: used_pct,
                            remaining_percent_5h: remain_pct,
                            resets_at_5h: end_iso.clone().map(|s| format!("통합 주간 크레딧 ({})", s)),
                            used_percent_weekly: used_pct,
                            remaining_percent_weekly: remain_pct,
                            resets_at_weekly: end_iso,
                            status_message: if period_over {
                                Some("크레딧 기간 리셋됨 (Grok 실행 시 새 기간 수치로 갱신)".into())
                            } else {
                                None
                            },
                            sub_groups: None,
                        };
                    }
                }
            }
        }
    }

    CliQuotaStatus {
        cli_id: "grok".into(),
        cli_name: "Grok CLI".into(),
        plan_label: "SuperGrok".into(),
        source_label: "로컬 세션 로그".into(),
        has_official_quota: false,
        used_percent_5h: 0.0,
        remaining_percent_5h: 100.0,
        resets_at_5h: None,
        used_percent_weekly: 0.0,
        remaining_percent_weekly: 100.0,
        resets_at_weekly: None,
        status_message: None,
        sub_groups: None,
    }
}

static AGY_QUOTA_CACHE: OnceLock<Mutex<Option<(Instant, CliQuotaStatus)>>> = OnceLock::new();

/// CLI 바이너리를 콘솔 창 없이 실행 (토큰 갱신 트리거용, 모델 호출 없음)
fn run_cli_silently(bin: &Path, args: &[&str]) {
    let mut cmd = std::process::Command::new(bin);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let _ = cmd.status();
}

fn rfc3339_expired(s: &str) -> bool {
    DateTime::parse_from_rfc3339(s)
        .map(|t| t.with_timezone(&Utc) <= Utc::now() + chrono::Duration::seconds(60))
        .unwrap_or(true)
}

/// Windows 자격 증명 관리자에서 agy가 저장한 OAuth 토큰(`gemini:antigravity`)을 읽는다.
#[cfg(target_os = "windows")]
fn read_agy_keyring_token() -> Option<(String, String)> {
    #[repr(C)]
    struct Credential {
        flags: u32,
        kind: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: [u32; 2],
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut std::ffi::c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }
    #[link(name = "advapi32")]
    extern "system" {
        fn CredReadW(target: *const u16, kind: u32, flags: u32, cred: *mut *mut Credential) -> i32;
        fn CredFree(buf: *mut std::ffi::c_void);
    }
    let target: Vec<u16> = "gemini:antigravity".encode_utf16().chain(std::iter::once(0)).collect();
    let mut p: *mut Credential = std::ptr::null_mut();
    // SAFETY: 표준 Win32 호출, 성공 시 반환 버퍼를 복사한 뒤 CredFree로 해제
    let raw = unsafe {
        if CredReadW(target.as_ptr(), 1 /* CRED_TYPE_GENERIC */, 0, &mut p) == 0 || p.is_null() {
            return None;
        }
        let c = &*p;
        let bytes = std::slice::from_raw_parts(c.blob, c.blob_size as usize).to_vec();
        CredFree(p as *mut _);
        bytes
    };
    let v: Value = serde_json::from_slice(&raw).ok()?;
    let tok = v.get("token")?;
    Some((
        tok.get("access_token")?.as_str()?.to_string(),
        tok.get("expiry")?.as_str()?.to_string(),
    ))
}

#[cfg(not(target_os = "windows"))]
fn read_agy_keyring_token() -> Option<(String, String)> {
    None
}

/// Antigravity 공식 쿼터 API(cloudcode-pa `retrieveUserQuotaSummary` + `retrieveUserQuota`) 실시간 조회.
/// (agy 업데이트 후 `--print /quota`는 모델 프롬프트로 처리되어 토큰만 소모하고 빈 응답을 줌)
fn fetch_antigravity_quota_worker() -> Option<CliQuotaStatus> {
    let agy_bin = crate::cli::home_dir().join("AppData").join("Local").join("agy").join("bin").join("agy.exe");
    let (mut token, expiry) = read_agy_keyring_token()?;
    if rfc3339_expired(&expiry) {
        // 만료 시 agy 자체 갱신 로직을 태운다 (`agy models`: 모델 호출 없이 인증만 갱신, 약 3초)
        run_cli_silently(&agy_bin, &["models"]);
        token = read_agy_keyring_token()?.0;
    }
    let post = |method: &str, body: Value| -> Option<Value> {
        ureq::post(&format!("https://cloudcode-pa.googleapis.com/v1internal:{}", method))
            .set("Authorization", &format!("Bearer {}", token))
            .set("User-Agent", "antigravity")
            .timeout(std::time::Duration::from_secs(6))
            .send_json(body)
            .ok()?
            .into_json()
            .ok()
    };
    let project = post("loadCodeAssist", serde_json::json!({ "metadata": { "ideType": "ANTIGRAVITY" } }))
        .and_then(|v| v.get("cloudaicompanionProject").and_then(|p| p.as_str()).map(|s| s.to_string()))
        .unwrap_or_default();
    let body = serde_json::json!({ "project": project });

    let mut sub_groups: Vec<crate::db::SubQuotaGroup> = Vec::new();
    // 1) 그룹 요약 (Claude/GPT 등 5시간·주간 버킷)
    if let Some(summary) = post("retrieveUserQuotaSummary", body.clone()) {
        for g in summary.get("groups").and_then(|g| g.as_array()).into_iter().flatten() {
            let mut grp = crate::db::SubQuotaGroup {
                name: g.get("displayName").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                description: g.get("description").and_then(|d| d.as_str()).map(|s| s.to_string()),
                remaining_5h: None,
                resets_at_5h: None,
                remaining_weekly: None,
                resets_at_weekly: None,
            };
            for b in g.get("buckets").and_then(|b| b.as_array()).into_iter().flatten() {
                let pct = (b.get("remainingFraction").and_then(|f| f.as_f64()).unwrap_or(1.0) * 100.0).clamp(0.0, 100.0).round();
                let reset = b.get("resetTime").and_then(|r| r.as_str()).and_then(format_iso_kst);
                match b.get("window").and_then(|w| w.as_str()) {
                    Some("5h") => (grp.remaining_5h, grp.resets_at_5h) = (Some(pct), reset),
                    Some("weekly") => (grp.remaining_weekly, grp.resets_at_weekly) = (Some(pct), reset),
                    _ => {}
                }
            }
            sub_groups.push(grp);
        }
    }

    // 2) 모델별 버킷: 메인 Gemini 쿼터 = gemini-* 모델 중 가장 적게 남은 값
    let quota = post("retrieveUserQuota", body)?;
    let mut gemini: Option<(f64, Option<String>)> = None;
    for b in quota.get("buckets").and_then(|b| b.as_array()).into_iter().flatten() {
        let model = b.get("modelId").and_then(|m| m.as_str()).unwrap_or("");
        if !model.starts_with("gemini") {
            continue;
        }
        let pct = (b.get("remainingFraction").and_then(|f| f.as_f64()).unwrap_or(1.0) * 100.0).clamp(0.0, 100.0).round();
        if gemini.as_ref().map_or(true, |(p, _)| pct < *p) {
            gemini = Some((pct, b.get("resetTime").and_then(|r| r.as_str()).and_then(format_iso_kst)));
        }
    }
    let (gem_pct, gem_reset) = gemini.unwrap_or((100.0, None));
    let weekly = sub_groups.iter().filter_map(|g| g.remaining_weekly.map(|w| (w, g.resets_at_weekly.clone()))).next();

    let res = CliQuotaStatus {
        cli_id: "antigravity".into(),
        cli_name: "Antigravity (agy)".into(),
        plan_label: "Google DeepMind".into(),
        source_label: "Antigravity 쿼터 연동".into(),
        has_official_quota: true,
        used_percent_5h: 100.0 - gem_pct,
        remaining_percent_5h: gem_pct,
        resets_at_5h: gem_reset,
        used_percent_weekly: weekly.as_ref().map_or(0.0, |w| 100.0 - w.0),
        remaining_percent_weekly: weekly.as_ref().map_or(100.0, |w| w.0),
        resets_at_weekly: weekly.and_then(|w| w.1),
        status_message: None,
        sub_groups: if sub_groups.is_empty() { None } else { Some(sub_groups) },
    };
    let cache_mutex = AGY_QUOTA_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = cache_mutex.lock() {
        *guard = Some((Instant::now(), res.clone()));
    }
    Some(res)
}

fn get_agy_cache_file() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AI_CLI_Manager")
        .join("antigravity_quota_cache.json")
}

fn save_agy_cache_to_disk(quota: &CliQuotaStatus) {
    let p = get_agy_cache_file();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(quota) {
        let _ = std::fs::write(p, json);
    }
}

fn load_agy_cache_from_disk() -> Option<CliQuotaStatus> {
    let p = get_agy_cache_file();
    if p.is_file() {
        if let Ok(metadata) = p.metadata() {
            if let Ok(modified) = metadata.modified() {
                if let Ok(elapsed) = modified.elapsed() {
                    if elapsed.as_secs() > 300 {
                        let _ = std::fs::remove_file(&p);
                        return None;
                    }
                }
            }
        }
        if let Ok(content) = std::fs::read_to_string(&p) {
            if let Ok(quota) = serde_json::from_str::<CliQuotaStatus>(&content) {
                return Some(quota);
            }
        }
    }
    None
}

pub fn extract_antigravity_quota(force_refresh: bool) -> CliQuotaStatus {
    let cache_mutex = AGY_QUOTA_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache_mutex.lock() {
        if let Some((fetched_at, cached)) = guard.as_ref() {
            if !force_refresh && fetched_at.elapsed().as_secs() < 60 {
                return cached.clone();
            }
        }
    }

    // 공식 API 조회는 모델 토큰을 쓰지 않으므로 캐시가 지나면 항상 다시 조회 (예전엔 트레이 새로고침에서만 조회해 수치가 멈춤)
    if let Some(res) = fetch_antigravity_quota_worker() {
        save_agy_cache_to_disk(&res);
        return res;
    }

    if let Ok(guard) = cache_mutex.lock() {
        if let Some((_, cached)) = guard.as_ref() {
            return cached.clone();
        }
    }

    // 디스크에 영구 저장된 직전 쿼터 즉시 복원 (앱 기동 시 0ms 지연 없음)
    if let Some(disk_cached) = load_agy_cache_from_disk() {
        if let Ok(mut guard) = cache_mutex.lock() {
            *guard = Some((Instant::now(), disk_cached.clone()));
        }
        return disk_cached;
    }

    // 조회 실패(agy 미로그인·네트워크 오류) 시 가짜 수치 대신 조회 불가 상태 표시
    unavailable_quota("antigravity", "Antigravity (agy)", "Google DeepMind", "Antigravity 쿼터 연동", "쿼터 조회 실패 (agy 로그인 상태 확인)")
}

/// DB 잠금을 잡기 전에 호출: 각 공식 쿼터 API를 병렬로 조회해 60초 캐시를 채운다.
/// (잠금 안에서 네트워크를 기다리면 다른 명령이 멈추므로, 이후 collect_all_cli_quotas는 캐시만 읽게 됨)
pub fn prefetch_live_quotas() {
    let claude_stale = CLAUDE_QUOTA_CACHE
        .get()
        .and_then(|m| m.lock().ok().and_then(|g| g.as_ref().map(|(at, _)| at.elapsed().as_secs() >= 60)))
        .unwrap_or(true);
    std::thread::scope(|s| {
        if claude_stale {
            s.spawn(|| fetch_claude_quota_worker());
        }
        s.spawn(|| extract_codex_quota());
        s.spawn(|| extract_grok_quota());
        s.spawn(|| extract_antigravity_quota(false));
    });
}

pub fn collect_all_cli_quotas(force_refresh: bool) -> Vec<CliQuotaStatus> {
    vec![
        extract_claude_quota(force_refresh),
        extract_codex_quota(),
        extract_grok_quota(),
        extract_antigravity_quota(force_refresh),
    ]
}

static INITIAL_LOG_SYNC_DONE: OnceLock<Mutex<bool>> = OnceLock::new();

pub fn ensure_logs_synced_once(conn: &Connection) {
    let flag = INITIAL_LOG_SYNC_DONE.get_or_init(|| Mutex::new(false));
    if let Ok(mut done) = flag.lock() {
        if !*done {
            *done = true;
            // Claude OAuth 쿼터는 ureq(인메모리 HTTP)로 콘솔 프로세스 생성 없이 즉시 비동기 수신
            std::thread::spawn(|| {
                fetch_claude_quota_worker();
            });
            let _ = sync_all_cli_logs(conn);
        }
    }
}

pub fn sync_all_cli_logs(conn: &Connection) -> Result<usize> {
    let _ = conn.execute(
        "DELETE FROM usage_logs WHERE event_hash LIKE 'baseline_%' OR event_hash LIKE 'claude_statscache_%' OR timestamp < '2026-09-01'",
        [],
    );
    // 이전 버전에서 중복/임의 추정으로 잘못 들어간 레코드 정리를 위해 codex 및 antigravity 로그 재구축
    let _ = conn.execute("DELETE FROM usage_logs WHERE cli_id = 'codex'", []);
    let _ = conn.execute("DELETE FROM usage_logs WHERE cli_id = 'antigravity'", []);

    let mut all_records = Vec::new();
    for cli in crate::cli::builtin_clis() {
        let parsed = match cli.id.as_str() {
            "claude" => claude_parser::scan_dir(&cli.log_path),
            "codex" => codex_parser::scan_dir(&cli.log_path),
            "grok" => grok_parser::scan_dir(&cli.log_path),
            "antigravity" => antigravity_parser::scan_dir(&cli.log_path),
            "cursor" => cursor_parser::scan_dir(&cli.log_path),
            _ => Vec::new(),
        };
        all_records.extend(parsed);
    }

    // Claude OAuth 쿼터 비동기 백그라운드 갱신 (블로킹 방지)
    let _ = extract_claude_quota(false);

    insert_usage_records(conn, &all_records)
}

pub fn record_live_session_interaction(conn: &Connection, cli_id: &str, input_bytes: usize) {
    if input_bytes == 0 {
        return;
    }
    let model = match cli_id {
        "claude" => "claude-opus-5",
        "codex" => "gpt-5-codex",
        "grok" => "grok-4.6",
        "cursor" => "cursor-claude-sonnet",
        "antigravity" => "gemini",
        _ => "custom-cli-model",
    };
    let inp = ((input_bytes as u64) * 4).max(32);
    let out = inp * 3;
    let cache = inp * 2;
    let now = Utc::now().to_rfc3339();
    let rec = ParsedUsageRecord {
        event_hash: format!("live_{}_{}", cli_id, uuid::Uuid::new_v4()),
        cli_id: cli_id.to_string(),
        timestamp: now,
        model_name: model.to_string(),
        input_tokens: inp,
        output_tokens: out,
        cache_tokens: cache,
        cost_usd: estimate_cost_usd(model, inp, out, cache),
    };
    let _ = insert_usage_records(conn, &[rec]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_parser_when_valid_jsonl_line_extracts_tokens_model_and_cache_accurately() {
        let sample = r#"{"timestamp":"2026-10-26T04:00:00Z","message":{"model":"claude-sonnet-4-20250514","usage":{"input_tokens":1200,"output_tokens":450,"cache_read_input_tokens":3000,"cache_creation_input_tokens":200}}}"#;
        let rec = claude_parser::parse_jsonl_line("session1.jsonl", 0, sample).expect("should parse");
        assert_eq!(rec.cli_id, "claude");
        assert_eq!(rec.model_name, "claude-sonnet-4-20250514");
        assert_eq!(rec.input_tokens, 1200);
        assert_eq!(rec.output_tokens, 450);
        assert_eq!(rec.cache_tokens, 3200);
        assert!(rec.cost_usd > 0.0);
    }

    #[test]
    fn claude_parser_when_zero_tokens_or_malformed_json_returns_none() {
        let zero_line = r#"{"timestamp":"2026-10-26T04:00:00Z","message":{"usage":{"input_tokens":0,"output_tokens":0}}}"#;
        assert!(claude_parser::parse_jsonl_line("s.jsonl", 1, zero_line).is_none());
        assert!(claude_parser::parse_jsonl_line("s.jsonl", 2, "{invalid json").is_none());
    }

    #[test]
    fn codex_parser_when_valid_session_line_extracts_prompt_and_completion_tokens() {
        let sample = r#"{"timestamp":"2026-10-26T05:00:00Z","model":"gpt-5-codex","usage":{"input_tokens":2500,"output_tokens":800,"cached_tokens":1000}}"#;
        let rec = codex_parser::parse_jsonl_line("codex_sess.jsonl", 0, sample).expect("should parse");
        assert_eq!(rec.cli_id, "codex");
        assert_eq!(rec.input_tokens, 1500); // 2500 raw minus 1000 cache
        assert_eq!(rec.output_tokens, 800);
        assert_eq!(rec.cache_tokens, 1000);
    }

    #[test]
    fn antigravity_parser_when_planner_response_step_extracts_usage_record() {
        let sample = r#"{"step_index":3,"type":"PLANNER_RESPONSE","created_at":"2026-10-26T05:10:00Z","input_tokens":1200,"output_tokens":300,"cache_read_tokens":400}"#;
        let rec = antigravity_parser::parse_jsonl_line("transcript.jsonl", 3, sample, "gemini-2.5-pro").expect("should parse");
        assert_eq!(rec.cli_id, "antigravity");
        assert_eq!(rec.input_tokens, 1200);
        assert_eq!(rec.output_tokens, 300);
        assert_eq!(rec.cache_tokens, 400);
    }
}

fn cli_stdout(bin: &Path, args: &[&str]) -> String {
    let mut cmd = std::process::Command::new(bin);
    cmd.args(args).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd.output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default()
}

/// CLI별 모델 목록. claude는 목록 명령이 없어 공식 별칭/ID를 고정 제공.
pub fn list_cli_models(cli_id: &str) -> Vec<String> {
    let home = crate::cli::home_dir();
    match cli_id {
        "claude" => ["opus", "sonnet", "haiku", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]
            .iter()
            .map(|s| s.to_string())
            .collect(),
        "codex" => std::fs::read_to_string(home.join(".codex").join("models_cache.json"))
            .ok()
            .and_then(|r| serde_json::from_str::<Value>(&r).ok())
            .and_then(|v| v.get("models").and_then(|m| m.as_array()).cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|m| m.get("slug").and_then(|s| s.as_str()).map(|s| s.to_string()))
            .collect(),
        // `grok models`: "  * grok-4.7 (default)" / "  - grok-4.6"
        "grok" => cli_stdout(&home.join(".grok").join("bin").join("grok.exe"), &["models"])
            .lines()
            .filter_map(|l| l.trim().strip_prefix("* ").or_else(|| l.trim().strip_prefix("- ")))
            .map(|l| l.split_whitespace().next().unwrap_or("").to_string())
            .filter(|m| !m.is_empty())
            .collect(),
        // `agy models`: "gemini-4-argon-medium	Gemini 4 Argon (Medium)"
        "antigravity" => cli_stdout(&home.join("AppData").join("Local").join("agy").join("bin").join("agy.exe"), &["models"])
            .lines()
            .filter(|l| l.contains('\t'))
            .map(|l| l.split('\t').next().unwrap_or("").trim().to_string())
            .filter(|m| !m.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod live_quota_tests {
    /// 실제 로그인 정보로 공식 쿼터 API 조회 확인: `cargo test live_quotas -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_quotas() {
        super::prefetch_live_quotas();
        for q in super::collect_all_cli_quotas(false) {
            println!("{} | {} | 5h {}% ({:?}) | wk {}% ({:?}) | {:?}", q.cli_id, q.source_label, q.remaining_percent_5h, q.resets_at_5h, q.remaining_percent_weekly, q.resets_at_weekly, q.status_message);
            assert!(q.has_official_quota, "{} 공식 쿼터 조회 실패", q.cli_id);
        }
        for cli in ["claude", "codex", "grok", "antigravity"] {
            let models = super::list_cli_models(cli);
            println!("{} models: {:?}", cli, models);
            assert!(!models.is_empty(), "{} 모델 목록 비어 있음", cli);
        }
    }
}
