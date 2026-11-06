use crate::db::{CliQuotaStatus, SubQuotaGroup};
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::{Duration as StdDuration, Instant};

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
    // SAFETY: CredReadW returns an allocated credential which is copied and freed.
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

fn strip_ansi(input: &str) -> String {
    let mut out = String::new();
    let mut chars = input.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.next() {
                Some('[') => for ch in chars.by_ref() { if ('\u{40}'..='\u{7e}').contains(&ch) { if matches!(ch, 'H' | 'f' | 'G') { out.push('\n'); } break; } },
                Some(']') => for ch in chars.by_ref() { if ch == '\x07' || ch == '\\' { break; } },
                _ => {}
            }
        } else if c == '\r' { out.push('\n'); }
        else if !c.is_control() || c == '\n' { out.push(c); }
    }
    out
}

fn reset_time(line: &str, now: DateTime<Utc>) -> Option<String> {
    let remaining = line.split_once("Refreshes in ")?.1;
    let mut minutes = 0i64;
    let mut found = false;
    for part in remaining.split_whitespace() {
        if let Some(n) = part.strip_suffix('h').and_then(|x| x.parse::<i64>().ok()) { minutes += n * 60; found = true; }
        if let Some(n) = part.strip_suffix('m').and_then(|x| x.parse::<i64>().ok()) { minutes += n; found = true; }
    }
    if !found { return None; }
    let offset = chrono::FixedOffset::east_opt(9 * 3600)?;
    let now_kst = now.with_timezone(&offset);
    let reset = (now + Duration::minutes(minutes)).with_timezone(&offset);
    Some(reset.format(if reset.date_naive() == now_kst.date_naive() { "%H:%M" } else { "%m/%d %H:%M" }).to_string())
}

fn parse_screen(screen: &str, now: DateTime<Utc>) -> Option<CliQuotaStatus> {
    let clean = strip_ansi(screen);
    let mut groups: Vec<SubQuotaGroup> = Vec::new();
    let mut window = None;
    let mut current = None;
    for line in clean.lines().map(str::trim) {
        if !line.is_empty() && line.chars().any(|c| c.is_ascii_alphabetic())
            && line.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == ' ' || c == '&') {
            current = Some(if let Some(index) = groups.iter().position(|g| g.name == line) { index } else {
                groups.push(SubQuotaGroup { name: line.into(), description: None, remaining_5h: None, resets_at_5h: None, remaining_weekly: None, resets_at_weekly: None, source_5h: None, source_weekly: None });
                groups.len() - 1
            });
            window = None;
        } else if let Some(description) = line.strip_prefix("Models within this group:") {
            if let Some(group) = current.and_then(|i| groups.get_mut(i)) { group.description = Some(description.trim().to_string()); }
        } else if line.contains("Five Hour Limit") { window = Some(true); }
        else if line.contains("Weekly Limit") { window = Some(false); }
        else if let (Some(group), Some(is_5h)) = (current.and_then(|i| groups.get_mut(i)), window) {
            let remaining = if line.contains("Quota available") { Some(100.0) } else {
                line.split_once('%').and_then(|(before, _)| before.trim_end().rsplit(|c: char| !c.is_ascii_digit() && c != '.').next()).and_then(|n| n.parse::<f64>().ok()).filter(|n| (0.0..=100.0).contains(n))
            };
            if let Some(value) = remaining {
                if is_5h { group.remaining_5h = Some(value); group.source_5h = Some("quota".into()); } else { group.remaining_weekly = Some(value); group.source_weekly = Some("quota".into()); }
            }
            if let Some(reset) = reset_time(line, now) {
                if is_5h { group.resets_at_5h = Some(reset); } else { group.resets_at_weekly = Some(reset); }
            }
        }
    }
    if !groups.iter().any(|g| g.remaining_5h.is_some() || g.remaining_weekly.is_some()) { return None; }
    Some(quota_from_groups(groups))
}

fn quota_from_groups(groups: Vec<SubQuotaGroup>) -> CliQuotaStatus {
    let main = groups.iter().find(|g| g.name.eq_ignore_ascii_case("GEMINI MODELS"));
    // shortcut: 누락된 창은 100%로 가정, 정보 없음 표현이 지원되면 교체한다.
    let five = main.and_then(|g| g.remaining_5h).unwrap_or(100.0);
    let weekly = main.and_then(|g| g.remaining_weekly).unwrap_or(100.0);
    CliQuotaStatus { cli_id: "antigravity".into(), cli_name: "Antigravity (agy)".into(), plan_label: "Google DeepMind".into(), source_label: "agy /quota + API".into(), has_official_quota: true,
        used_percent_5h: 100.0-five, remaining_percent_5h: five, resets_at_5h: main.and_then(|g| g.remaining_5h.and(g.resets_at_5h.clone())), used_percent_weekly: 100.0-weekly, remaining_percent_weekly: weekly, resets_at_weekly: main.and_then(|g| g.remaining_weekly.and(g.resets_at_weekly.clone())), status_message: None, sub_groups: Some(groups) }
}

fn api_bucket(bucket: &Value, now: DateTime<Utc>) -> Option<(f64, Option<String>)> {
    let fraction = bucket.get("remainingFraction")?.as_f64()?;
    if !(0.0..=1.0).contains(&fraction) { return None; }
    let reset = bucket.get("resetTime").and_then(Value::as_str);
    let expired = reset.and_then(|s| DateTime::parse_from_rfc3339(s).ok()).is_some_and(|r| r.with_timezone(&Utc) <= now);
    Some((if expired { 100.0 } else { fraction * 100.0 }, reset.and_then(crate::usage::format_iso_kst)))
}

fn parse_api(summary: Option<&Value>, quota: Option<&Value>, now: DateTime<Utc>) -> Vec<SubQuotaGroup> {
    let mut groups = Vec::new();
    for value in summary.and_then(|v| v.get("groups")).and_then(Value::as_array).into_iter().flatten() {
        let Some(name) = value.get("displayName").and_then(Value::as_str).filter(|s| !s.is_empty()) else { continue };
        let mut group = SubQuotaGroup { name: name.into(), description: value.get("description").and_then(Value::as_str).map(str::to_string), remaining_5h: None, resets_at_5h: None, remaining_weekly: None, resets_at_weekly: None, source_5h: None, source_weekly: None };
        for bucket in value.get("buckets").and_then(Value::as_array).into_iter().flatten() {
            if let Some((percent, reset)) = api_bucket(bucket, now) {
                match bucket.get("window").and_then(Value::as_str) {
                    Some("5h") => { group.remaining_5h = Some(percent); group.resets_at_5h = reset; group.source_5h = Some("api".into()); }
                    Some("weekly") => { group.remaining_weekly = Some(percent); group.resets_at_weekly = reset; group.source_weekly = Some("api".into()); }
                    _ => {}
                }
            }
        }
        if group.remaining_5h.is_some() || group.remaining_weekly.is_some() { groups.push(group); }
    }
    let gemini: Vec<_> = quota.and_then(|q| q.get("buckets")).and_then(Value::as_array).into_iter().flatten()
        .filter(|b| b.get("modelId").and_then(Value::as_str).is_some_and(|id| id.starts_with("gemini-")))
        .filter_map(|b| api_bucket(b, now)).collect();
    if let Some((value, reset)) = gemini.first() {
        if gemini.iter().all(|(v, r)| (v - value).abs() <= 0.01 && r == reset) {
            groups = merge_groups(groups, vec![SubQuotaGroup { name: "GEMINI MODELS".into(), description: None, remaining_5h: None, resets_at_5h: None, remaining_weekly: Some(*value), resets_at_weekly: reset.clone(), source_5h: None, source_weekly: Some("api".into()) }]);
        } else { eprintln!("Antigravity API Gemini 쿼터 값이 달라 주간 병합을 건너뜁니다."); }
    }
    groups
}

fn fetch_api() -> Result<Vec<SubQuotaGroup>, String> {
    let (token, _) = read_agy_keyring_token().ok_or("agy 인증 정보를 읽지 못했습니다")?;
    let post = |method: &str, body: Value| -> Option<Value> {
        ureq::post(&format!("https://cloudcode-pa.googleapis.com/v1internal:{method}"))
            .set("Authorization", &format!("Bearer {token}")).set("User-Agent", "antigravity")
            .timeout(StdDuration::from_secs(6)).send_json(body).ok()?.into_json().ok()
    };
    let project = post("loadCodeAssist", serde_json::json!({"metadata":{"ideType":"ANTIGRAVITY"}}))
        .and_then(|v| v.get("cloudaicompanionProject").and_then(Value::as_str).map(str::to_string)).unwrap_or_default();
    let body = serde_json::json!({"project": project});
    let summary = post("retrieveUserQuotaSummary", body.clone());
    let quota = post("retrieveUserQuota", body);
    let groups = parse_api(summary.as_ref(), quota.as_ref(), Utc::now());
    if groups.is_empty() { Err("공식 API 쿼터 조회 실패".into()) } else { Ok(groups) }
}

fn merge_groups(mut primary: Vec<SubQuotaGroup>, secondary: Vec<SubQuotaGroup>) -> Vec<SubQuotaGroup> {
    for from in secondary {
        if let Some(to) = primary.iter_mut().find(|g| g.name.eq_ignore_ascii_case(&from.name)) {
            for (window, current, current_reset, current_source, fallback, fallback_reset, fallback_source) in [
                ("5h", &mut to.remaining_5h, &mut to.resets_at_5h, &mut to.source_5h, from.remaining_5h, from.resets_at_5h, from.source_5h),
                ("weekly", &mut to.remaining_weekly, &mut to.resets_at_weekly, &mut to.source_weekly, from.remaining_weekly, from.resets_at_weekly, from.source_weekly),
            ] {
                if let (Some(a), Some(b)) = (*current, fallback) {
                    if (a - b).abs() > 2.0 { eprintln!("Antigravity 쿼터 차이: {} {window}", to.name.replace(['\r', '\n'], " ")); }
                } else if current.is_none() && fallback.is_some() {
                    *current = fallback; *current_reset = fallback_reset; *current_source = fallback_source;
                }
            }
            if to.description.is_none() { to.description = from.description; }
        } else { primary.push(from); }
    }
    primary
}

pub fn fetch_combined() -> Result<(CliQuotaStatus, bool), String> {
    std::thread::scope(|s| {
        let screen = s.spawn(fetch);
        let api = s.spawn(fetch_api);
        let screen = screen.join().unwrap_or_else(|_| Err("agy 화면 수집 실패".into()));
        let api = api.join().unwrap_or_else(|_| Err("공식 API 수집 실패".into()));
        combine_results(screen, api)
    })
}

fn combine_results(screen: Result<CliQuotaStatus, String>, api: Result<Vec<SubQuotaGroup>, String>) -> Result<(CliQuotaStatus, bool), String> {
    match (screen, api) {
        (Ok(screen), Ok(api)) => Ok((quota_from_groups(merge_groups(screen.sub_groups.unwrap_or_default(), api)), true)),
        (Ok(screen), Err(_)) => Ok((screen, false)),
        (Err(_), Ok(api)) => Ok((quota_from_groups(api), false)),
        (Err(a), Err(b)) => Err(format!("{a}; {b}")),
    }
}

fn failure_reason(sent: bool, output: &[u8]) -> String {
    if !sent { "agy 시작 화면을 확인하지 못했습니다" }
    else if !String::from_utf8_lossy(output).contains("Models & Quota") { "agy /quota 화면이 열리지 않았습니다" }
    else { "agy /quota 응답이 불완전하거나 형식이 다릅니다" }.to_string()
}

fn completed_screen(output: &str, idle: bool) -> Option<CliQuotaStatus> {
    let clean = strip_ansi(output);
    if !clean.contains("Models & Quota") { return None; }
    let footer = clean.rfind("esc Close")?;
    let last_limit = clean.rfind("Limit")?;
    if !idle && footer < last_limit { return None; }
    parse_screen(&clean, Utc::now())
}

struct QuotaHome(std::path::PathBuf);

impl QuotaHome {
    fn new() -> std::io::Result<Self> {
        let path = std::env::temp_dir().join(format!("agentrix-agy-quota-{}", uuid::Uuid::new_v4()));
        let home = Self(path);
        let config = home.0.join(".gemini/antigravity-cli");
        std::fs::create_dir_all(config.join("cache"))?;
        std::fs::write(config.join("cache/onboarding.json"), r#"{"consumerOnboardingComplete":true,"enterpriseOnboardingComplete":false,"onboardingComplete":true}"#)?;
        std::fs::write(config.join("settings.json"), serde_json::json!({"trustedWorkspaces": [home.0.to_string_lossy()]}).to_string())?;
        Ok(home)
    }

    fn path(&self) -> &std::path::Path { &self.0 }
}

impl Drop for QuotaHome {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

fn quota_command(bin: &std::path::Path, cwd: &std::path::Path) -> portable_pty::CommandBuilder {
    let mut command = portable_pty::CommandBuilder::new(bin);
    command.cwd(cwd);
    for name in ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"] { command.env(name, cwd); }
    command.env("AGY_CLI_DISABLE_AUTO_UPDATE", "true");
    command
}

pub fn fetch() -> Result<CliQuotaStatus, String> {
    let bin = crate::cli::home_dir().join("AppData").join("Local").join("agy").join("bin").join("agy.exe");
    let pair = portable_pty::native_pty_system().openpty(portable_pty::PtySize { rows: 100, cols: 120, pixel_width: 0, pixel_height: 0 }).map_err(|_| "PTY 생성 실패".to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|_| "PTY 출력 연결 실패".to_string())?;
    let mut writer = pair.master.take_writer().map_err(|_| "PTY 입력 연결 실패".to_string())?;
    let home = QuotaHome::new().map_err(|_| "쿼터 수집용 임시 폴더 생성 실패".to_string())?;
    let cwd = home.path();
    if cwd.as_os_str().is_empty() { return Err("안전한 작업 폴더를 찾지 못했습니다".into()); }
    crate::cli::log_auxiliary("agy_quota::fetch", &bin, cwd);
    let command = quota_command(&bin, cwd);
    let mut child = pair.slave.spawn_command(command).map_err(|_| "agy 실행 실패".to_string())?;
    drop(pair.slave);
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || { let mut buf = [0u8; 8192]; while let Ok(n) = reader.read(&mut buf) { if n == 0 || tx.send(buf[..n].to_vec()).is_err() { break; } } });
    let deadline = Instant::now() + StdDuration::from_secs(15);
    let mut output = Vec::new();
    let mut sent = false;
    let mut cursor_replied = false;
    let mut result = None;
    while Instant::now() < deadline {
        if let Ok(bytes) = rx.recv_timeout(StdDuration::from_millis(200)) {
            output.extend(bytes);
            if output.len() > 1_000_000 { break; }
            if !sent && !cursor_replied && output.windows(4).any(|w| w == b"\x1b[6n") { let _ = writer.write_all(b"\x1b[1;1R"); cursor_replied = true; }
            let text = String::from_utf8_lossy(&output);
            if !sent && (text.contains("for shortcuts") || text.contains("Type a message")) {
                if writer.write_all(b"/quota\r").is_err() { break; }
                sent = true;
                output.clear();
            } else if sent {
                if let Some(quota) = completed_screen(&text, false) { result = Some(quota); break; }
            }
        } else if sent {
            let text = String::from_utf8_lossy(&output);
            if let Some(quota) = completed_screen(&text, true) { result = Some(quota); break; }
        }
    }
    #[cfg(windows)]
    if let (Some(pid), Ok(None)) = (child.process_id(), child.try_wait()) {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .output();
    }
    let _ = child.kill();
    let _ = child.wait();
    #[cfg(test)]
    if result.is_none() {
        let safe = strip_ansi(&String::from_utf8_lossy(&output));
        let safe = safe.lines().map(|line| if line.contains('@') { "[redacted]" } else { line }).collect::<Vec<_>>().join("\n");
        eprintln!("quota screen:\n{safe}");
    }
    result.ok_or_else(|| failure_reason(sent, &output))
}

#[cfg(test)]
mod tests {
    #[test]
    fn quota_command_disables_auto_updater() {
        let command = super::quota_command(std::path::Path::new("agy.exe"), std::path::Path::new("test-home"));
        assert_eq!(command.get_env("AGY_CLI_DISABLE_AUTO_UPDATE"), Some(std::ffi::OsStr::new("true")));
    }
    #[test]
    fn quota_home_is_isolated_and_pretrusted() {
        let home = super::QuotaHome::new().unwrap();
        let root = home.path();
        let settings: serde_json::Value = serde_json::from_slice(&std::fs::read(root.join(".gemini/antigravity-cli/settings.json")).unwrap()).unwrap();
        assert_eq!(settings["trustedWorkspaces"][0], root.to_string_lossy().as_ref());
        assert!(!root.join(".gemini/antigravity/mcp_config.json").exists());
        assert!(!root.join(".gemini/config/mcp_config.json").exists());
        let path = root.to_path_buf();
        drop(home);
        assert!(!path.exists());
    }
    use super::*;
    #[test]
    fn failure_message_identifies_stage_without_echoing_output() {
        assert!(failure_reason(false, b"").contains("시작 화면"));
        assert!(failure_reason(true, b"private output").contains("열리지"));
        assert!(failure_reason(true, b"Models & Quota").contains("형식"));
    }
    #[test]
    fn parses_quota_groups() {
        let screen = "Models & Quota\nGEMINI MODELS\nModels within this group: Gemini Flash, Gemini Pro\nWeekly Limit Remaining\n[bar] 24.67%\nRefreshes in 2h 29m\nFive Hour Limit Remaining\n[bar] 94.71%\nRefreshes in 2h 47m\nCLAUDE AND GPT MODELS\nWeekly Limit Remaining\n49.26%\nRefreshes in 23h 40m\nFive Hour Limit Remaining\nQuota available\nGEMINI 4 ARGON\nWeekly Limit Remaining\n0.00%\nRefreshes in 2h 29m\n";
        let now = DateTime::parse_from_rfc3339("2026-11-02T02:35:00Z").unwrap().to_utc();
        let q = parse_screen(screen, now).unwrap();
        assert_eq!((q.remaining_percent_5h, q.remaining_percent_weekly), (94.71, 24.67));
        assert_eq!(q.resets_at_weekly.as_deref(), Some("14:04"));
        let g = q.sub_groups.unwrap();
        assert_eq!(g[0].description.as_deref(), Some("Gemini Flash, Gemini Pro"));
        assert_eq!(g[1].remaining_5h, Some(100.0));
        assert_eq!(g[2].remaining_weekly, Some(0.0));
        assert_eq!(g[2].remaining_5h, None);
    }
    #[test]
    fn accepts_a_single_gemini_window() {
        let now = DateTime::parse_from_rfc3339("2026-11-02T02:35:00Z").unwrap().to_utc();
        let five_only = "Models & Quota\nGEMINI MODELS\nFive Hour Limit Remaining\n94.71%\nRefreshes in 2h 47m\n";
        let q = parse_screen(five_only, now).unwrap();
        assert_eq!((q.remaining_percent_5h, q.remaining_percent_weekly), (94.71, 100.0));
        assert_eq!(q.resets_at_weekly, None);
        let weekly_only = "Models & Quota\nGEMINI MODELS\nWeekly Limit Remaining\nQuota available\n";
        let q = parse_screen(weekly_only, now).unwrap();
        assert_eq!((q.remaining_percent_5h, q.remaining_percent_weekly), (100.0, 100.0));
        assert_eq!((q.resets_at_5h, q.resets_at_weekly), (None, None));
        assert!(parse_screen("GEMINI MODELS\nWeekly Limit Remaining", now).is_none());
    }
    #[test]
    fn screen_handles_repeated_heading_and_percent_adjacent_to_bar() {
        let screen = "Models & Quota\nGEMINI MODELS\nGEMINI MODELS\nWeekly Limit Remaining\n[████]100.00%\nQuota available\nFive Hour Limit Remaining\n[████]100.00%\nQuota available\nCLAUDE AND GPT MODELS\nWeekly Limit Remaining\n[██]49.26%\nRefreshes in 20h 39m\nFive Hour Limit Remaining\nQuota available\nGEMINI 4 ARGON\nWeekly Limit Remaining\nQuota available\n";
        let q = parse_screen(screen, Utc::now()).unwrap();
        assert_eq!((q.remaining_percent_5h, q.remaining_percent_weekly), (100.0, 100.0));
        assert_eq!(q.sub_groups.unwrap().iter().find(|g| g.name == "CLAUDE AND GPT MODELS").unwrap().remaining_weekly, Some(49.26));
    }
    #[test]
    fn parses_pm_failure_screen() {
        let screen = include_str!("../tests/fixtures/agy_quota_failure.txt");
        let q = completed_screen(screen, false).unwrap();
        assert_eq!((q.remaining_percent_5h, q.remaining_percent_weekly), (100.0, 100.0));
        let groups = q.sub_groups.unwrap();
        assert_eq!(groups.iter().find(|g| g.name == "CLAUDE AND GPT MODELS").unwrap().remaining_weekly, Some(49.26));
        assert_eq!(groups.iter().find(|g| g.name == "GEMINI 4 ARGON").unwrap().remaining_weekly, Some(100.0));
    }
    #[test]
    fn api_fallback_and_per_window_priority() {
        let now = Utc::now();
        let summary = serde_json::json!({"groups":[{"displayName":"Claude and GPT models","buckets":[{"window":"weekly","remainingFraction":0.4926},{"window":"5h","remainingFraction":1.0}]}]});
        let quota = serde_json::json!({"buckets":[{"modelId":"gemini-a","remainingFraction":0.25},{"modelId":"gemini-b","remainingFraction":0.25}]});
        let api = parse_api(Some(&summary), Some(&quota), now);
        let (fallback, complete) = combine_results(Err("screen failed".into()), Ok(api.clone())).unwrap();
        assert!(!complete);
        assert_eq!(fallback.remaining_percent_weekly, 25.0);
        assert_eq!(fallback.sub_groups.as_ref().unwrap().iter().find(|g| g.name.contains("Claude")).unwrap().remaining_5h, Some(100.0));
        let screen = parse_screen("GEMINI MODELS\nFive Hour Limit Remaining\n94.71%\n", now).unwrap();
        let (merged, complete) = combine_results(Ok(screen), Ok(api)).unwrap();
        assert!(complete);
        assert_eq!((merged.remaining_percent_5h, merged.remaining_percent_weekly), (94.71, 25.0));
        let main = merged.sub_groups.unwrap().into_iter().find(|g| g.name == "GEMINI MODELS").unwrap();
        assert_eq!(main.source_5h.as_deref(), Some("quota"));
        assert_eq!(main.source_weekly.as_deref(), Some("api"));
    }
    #[test]
    #[ignore]
    fn live_screen_smoke() {
        let quota = fetch().expect("interactive quota unavailable");
        println!("5h={} weekly={} resets={:?}/{:?} groups={:?}", quota.remaining_percent_5h, quota.remaining_percent_weekly, quota.resets_at_5h, quota.resets_at_weekly, quota.sub_groups.unwrap().iter().map(|g| (&g.name, g.remaining_5h, g.remaining_weekly)).collect::<Vec<_>>());
    }
    #[test]
    #[ignore]
    fn live_combined_smoke() {
        let (quota, complete) = fetch_combined().expect("quota sources unavailable");
        println!("complete={complete} 5h={} weekly={} groups={:?}", quota.remaining_percent_5h, quota.remaining_percent_weekly, quota.sub_groups.unwrap().iter().map(|g| (&g.name, &g.source_5h, &g.source_weekly)).collect::<Vec<_>>());
    }
}
