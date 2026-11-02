use crate::db::{CliQuotaStatus, SubQuotaGroup};
use chrono::{DateTime, Duration, Utc};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::{Duration as StdDuration, Instant};

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
    for line in clean.lines().map(str::trim) {
        if !line.is_empty() && line.chars().any(|c| c.is_ascii_alphabetic())
            && line.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == ' ' || c == '&') {
            groups.push(SubQuotaGroup { name: line.into(), description: None, remaining_5h: None, resets_at_5h: None, remaining_weekly: None, resets_at_weekly: None });
            window = None;
        } else if let Some(description) = line.strip_prefix("Models within this group:") {
            if let Some(group) = groups.last_mut() { group.description = Some(description.trim().to_string()); }
        } else if line.contains("Five Hour Limit") { window = Some(true); }
        else if line.contains("Weekly Limit") { window = Some(false); }
        else if let (Some(group), Some(is_5h)) = (groups.last_mut(), window) {
            let remaining = if line.contains("Quota available") { Some(100.0) } else {
                line.split_once('%').and_then(|(before, _)| before.split_whitespace().last()).and_then(|n| n.parse::<f64>().ok()).filter(|n| (0.0..=100.0).contains(n))
            };
            if let Some(value) = remaining {
                if is_5h { group.remaining_5h = Some(value); } else { group.remaining_weekly = Some(value); }
            }
            if let Some(reset) = reset_time(line, now) {
                if is_5h { group.resets_at_5h = Some(reset); } else { group.resets_at_weekly = Some(reset); }
            }
        }
    }
    let main = groups.iter().find(|g| g.name.contains("GEMINI MODELS"))?;
    let five = main.remaining_5h?;
    let weekly = main.remaining_weekly?;
    Some(CliQuotaStatus { cli_id: "antigravity".into(), cli_name: "Antigravity (agy)".into(), plan_label: "Google DeepMind".into(), source_label: "agy /quota".into(), has_official_quota: true,
        used_percent_5h: 100.0-five, remaining_percent_5h: five, resets_at_5h: main.resets_at_5h.clone(), used_percent_weekly: 100.0-weekly, remaining_percent_weekly: weekly, resets_at_weekly: main.resets_at_weekly.clone(), status_message: None, sub_groups: Some(groups) })
}

pub fn fetch() -> Option<CliQuotaStatus> {
    let bin = crate::cli::home_dir().join("AppData").join("Local").join("agy").join("bin").join("agy.exe");
    let pair = portable_pty::native_pty_system().openpty(portable_pty::PtySize { rows: 100, cols: 120, pixel_width: 0, pixel_height: 0 }).ok()?;
    let mut reader = pair.master.try_clone_reader().ok()?;
    let mut writer = pair.master.take_writer().ok()?;
    let mut child = pair.slave.spawn_command(portable_pty::CommandBuilder::new(bin)).ok()?;
    drop(pair.slave);
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || { let mut buf = [0u8; 8192]; while let Ok(n) = reader.read(&mut buf) { if n == 0 || tx.send(buf[..n].to_vec()).is_err() { break; } } });
    let deadline = Instant::now() + StdDuration::from_secs(15);
    let mut output = Vec::new();
    let mut sent = false;
    let mut result = None;
    while Instant::now() < deadline {
        if let Ok(bytes) = rx.recv_timeout(StdDuration::from_millis(200)) {
            output.extend(bytes);
            if output.len() > 1_000_000 { break; }
            if !sent && output.ends_with(b"\x1b[6n") { let _ = writer.write_all(b"\x1b[1;1R"); }
            let text = String::from_utf8_lossy(&output);
            if !sent && (text.contains("for shortcuts") || text.contains("Type a message")) {
                if writer.write_all(b"/quota\r").is_err() { break; }
                sent = true;
                output.clear();
            }
        } else if sent {
            let text = String::from_utf8_lossy(&output);
            if text.contains("Models & Quota") && text.contains("esc Close") {
                if let Some(quota) = parse_screen(&text, Utc::now()) { result = Some(quota); break; }
            }
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
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
    #[ignore]
    fn live_screen_smoke() {
        let quota = fetch().expect("interactive quota unavailable");
        println!("5h={} weekly={} resets={:?}/{:?} groups={:?}", quota.remaining_percent_5h, quota.remaining_percent_weekly, quota.resets_at_5h, quota.resets_at_weekly, quota.sub_groups.unwrap().iter().map(|g| (&g.name, g.remaining_5h, g.remaining_weekly)).collect::<Vec<_>>());
    }
}
