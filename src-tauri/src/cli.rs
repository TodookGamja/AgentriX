use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CliDefinition {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub binary_candidates: Vec<String>,
    pub resolved_binary: Option<String>,
    pub wrapper_binary: Option<String>,
    pub installed: bool,
    pub is_custom: bool,
    pub args: Vec<String>,
    pub env_keys: Vec<String>,
    pub login_command: String,
    pub config_path: PathBuf,
    pub skills_dir: PathBuf,
    pub log_path: PathBuf,
    pub subscription_detected: bool,
    pub accent_color: String,
}

pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn builtin_clis() -> Vec<CliDefinition> {
    let home = home_dir();
    vec![
        CliDefinition {
            id: "claude".into(),
            name: "Claude Code".into(),
            provider: "Anthropic".into(),
            binary_candidates: vec![
                "claude.exe".into(),
                "claude.cmd".into(),
                "claude.ps1".into(),
                "claude".into(),
            ],
            resolved_binary: None,
            wrapper_binary: None,
            installed: false,
            is_custom: false,
            args: vec![],
            env_keys: vec!["ANTHROPIC_API_KEY".into()],
            login_command: "claude login".into(),
            config_path: home.join(".claude.json"),
            skills_dir: home.join(".claude").join("skills"),
            log_path: home.join(".claude").join("projects"),
            subscription_detected: home.join(".claude").join(".credentials.json").exists()
                || home.join(".claude.json").exists(),
            accent_color: "#f97316".into(),
        },
        CliDefinition {
            id: "codex".into(),
            name: "Codex CLI".into(),
            provider: "OpenAI".into(),
            binary_candidates: vec![
                "codex.cmd".into(),
                "codex.exe".into(),
                "codex.ps1".into(),
                "codex".into(),
            ],
            resolved_binary: None,
            wrapper_binary: None,
            installed: false,
            is_custom: false,
            args: vec![],
            env_keys: vec!["OPENAI_API_KEY".into()],
            login_command: "codex login".into(),
            config_path: home.join(".codex").join("config.toml"),
            skills_dir: home.join(".codex").join("skills"),
            log_path: home.join(".codex").join("sessions"),
            subscription_detected: home.join(".codex").join("auth.json").exists()
                || home.join(".codex").join("config.toml").exists(),
            accent_color: "#10b981".into(),
        },
        CliDefinition {
            id: "grok".into(),
            name: "Grok CLI".into(),
            provider: "xAI".into(),
            binary_candidates: vec![
                "grok.exe".into(),
                "grok.cmd".into(),
                "hgrok.cmd".into(),
                "grok".into(),
            ],
            resolved_binary: None,
            wrapper_binary: None,
            installed: false,
            is_custom: false,
            args: vec![],
            env_keys: vec!["XAI_API_KEY".into()],
            login_command: "grok login".into(),
            config_path: home.join(".grok").join("config.toml"),
            skills_dir: home.join(".grok").join("skills"),
            log_path: home.join(".grok").join("sessions"),
            subscription_detected: home.join(".grok").join("auth.json").exists()
                || home.join(".grok").join("config.toml").exists(),
            accent_color: "#eab308".into(),
        },
        CliDefinition {
            id: "antigravity".into(),
            name: "Antigravity (agy)".into(),
            provider: "Google DeepMind".into(),
            binary_candidates: vec![
                "agy.exe".into(),
                "agy.cmd".into(),
                "antigravity.exe".into(),
                "agy".into(),
            ],
            resolved_binary: None,
            wrapper_binary: None,
            installed: false,
            is_custom: false,
            args: vec![],
            env_keys: vec!["GEMINI_API_KEY".into(), "GOOGLE_API_KEY".into()],
            login_command: "agy".into(),
            config_path: home.join(".gemini").join("config").join("mcp_config.json"),
            skills_dir: home.join(".gemini").join("config").join("skills"),
            log_path: home.join(".gemini").join("antigravity-cli").join("brain"),
            subscription_detected: home
                .join(".gemini")
                .join("antigravity-cli")
                .join("installation_id")
                .exists()
                || home
                    .join(".gemini")
                    .join("antigravity-cli")
                    .join("jetski_state.pbtxt")
                    .exists(),
            accent_color: "#8b5cf6".into(),
        },
        CliDefinition {
            id: "cursor".into(),
            name: "Cursor Agent CLI".into(),
            provider: "Anysphere".into(),
            binary_candidates: vec![
                "cursor.cmd".into(),
                "cursor.exe".into(),
                "agent.exe".into(),
                "cursor".into(),
            ],
            resolved_binary: None,
            wrapper_binary: None,
            installed: false,
            is_custom: false,
            args: vec![],
            env_keys: vec!["CURSOR_API_KEY".into()],
            login_command: "cursor login".into(),
            config_path: home.join(".cursor").join("mcp.json"),
            skills_dir: home.join(".cursor").join("skills"),
            log_path: home.join(".cursor").join("projects"),
            subscription_detected: home.join(".cursor").join("cli-config.json").exists()
                || home.join(".cursor").join("agent-cli-state.json").exists(),
            accent_color: "#3b82f6".into(),
        },
        CliDefinition {
            id: "opencode".into(),
            name: "OpenCode CLI".into(),
            provider: "OpenCode".into(),
            binary_candidates: vec![
                "opencode.cmd".into(),
                "opencode.exe".into(),
                "opencode.ps1".into(),
                "opencode".into(),
            ],
            resolved_binary: None,
            wrapper_binary: None,
            installed: false,
            is_custom: false,
            args: vec![],
            env_keys: vec!["OPENAI_API_KEY".into(), "ANTHROPIC_API_KEY".into()],
            login_command: "opencode auth".into(),
            config_path: home.join(".config").join("opencode").join("config.json"),
            skills_dir: home.join(".config").join("opencode").join("skills"),
            log_path: home.join(".config").join("opencode"),
            subscription_detected: home.join("AppData").join("Roaming").join("npm").join("opencode.cmd").exists(),
            accent_color: "#ec4899".into(),
        },
        CliDefinition {
            id: "powershell".into(),
            name: "PowerShell".into(),
            provider: "Microsoft".into(),
            binary_candidates: vec![
                "powershell.exe".into(),
                "pwsh.exe".into(),
            ],
            resolved_binary: Some("powershell.exe".into()),
            wrapper_binary: None,
            installed: true,
            is_custom: false,
            args: vec![],
            env_keys: vec![],
            login_command: "".into(),
            config_path: home.join("Documents").join("WindowsPowerShell"),
            skills_dir: home.join(".powershell").join("skills"),
            log_path: home.join(".powershell").join("logs"),
            subscription_detected: true,
            accent_color: "#38bdf8".into(),
        },
        CliDefinition {
            id: "cmd".into(),
            name: "명령 프롬프트 (CMD)".into(),
            provider: "Microsoft".into(),
            binary_candidates: vec![
                "cmd.exe".into(),
            ],
            resolved_binary: Some("cmd.exe".into()),
            wrapper_binary: None,
            installed: true,
            is_custom: false,
            args: vec![],
            env_keys: vec![],
            login_command: "".into(),
            config_path: home.clone(),
            skills_dir: home.clone(),
            log_path: home.clone(),
            subscription_detected: true,
            accent_color: "#94a3b8".into(),
        },
    ]
}

pub fn detect_clis() -> Vec<CliDefinition> {
    let path_env = std::env::var("PATH").unwrap_or_default();
    detect_clis_with_path(&path_env)
}

pub fn detect_all_clis_with_db(conn: &Connection) -> Vec<CliDefinition> {
    let path_env = std::env::var("PATH").unwrap_or_default();
    let mut list = detect_clis_with_path(&path_env);

    if let Ok(customs) = crate::db::get_custom_clis(conn) {
        for mut custom in customs {
            if let Some(found) = resolve_cli_binary(&custom.id, &custom.binary_candidates, &path_env) {
                custom.resolved_binary = Some(found.to_string_lossy().into_owned());
                custom.installed = true;
            } else if let Some(first) = custom.binary_candidates.first() {
                let p = PathBuf::from(first);
                if p.is_file() {
                    custom.resolved_binary = Some(first.clone());
                    custom.installed = true;
                }
            }
            list.push(custom);
        }
    }

    list
}

pub fn detect_clis_with_path(path_env: &str) -> Vec<CliDefinition> {
    let home = home_dir();
    let local_bin = home.join(".local").join("bin");

    let mut list = builtin_clis();
    for def in &mut list {
        if let Some(found) = resolve_cli_binary(&def.id, &def.binary_candidates, path_env) {
            def.resolved_binary = Some(found.to_string_lossy().into_owned());
            def.installed = true;
        }
        // Headroom 래퍼(hclaude.cmd, hcodex.cmd, hgrok.cmd, hagy.cmd, hcursor.cmd, hopencode.cmd) 감지
        let wrapper_name = match def.id.as_str() {
            "claude" => Some("hclaude.cmd"),
            "codex" => Some("hcodex.cmd"),
            "grok" => Some("hgrok.cmd"),
            "antigravity" => Some("hagy.cmd"),
            "cursor" => Some("hcursor.cmd"),
            "opencode" => Some("hopencode.cmd"),
            _ => None,
        };
        if let Some(wname) = wrapper_name {
            let wp = local_bin.join(wname);
            if wp.is_file() {
                def.wrapper_binary = Some(wp.to_string_lossy().into_owned());
            } else if local_bin.join("headroom.exe").is_file() {
                def.wrapper_binary = Some(wp.to_string_lossy().into_owned());
            }
        }
    }
    list
}

pub fn resolve_cli_binary(
    cli_id: &str,
    candidates: &[String],
    path_env: &str,
) -> Option<PathBuf> {
    // 1. 후보 자체가 절대 경로인 경우 먼저 확인
    for cand in candidates {
        let p = Path::new(cand);
        if p.is_absolute() && p.is_file() {
            return Some(p.to_path_buf());
        }
    }

    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in path_env.split(sep) {
        let dir = dir.trim().trim_matches('"');
        if dir.is_empty() {
            continue;
        }
        let dir_path = Path::new(dir);
        for cand in candidates {
            let full = dir_path.join(cand);
            if full.is_file() {
                return Some(full);
            }
        }
    }

    // 2. Windows 사용자 홈 및 표준 설치 경로 폴백 (실측 기반)
    let home = home_dir();
    let npm_dir = home.join("AppData").join("Roaming").join("npm");
    let local_bin = home.join(".local").join("bin");
    let local_appdata = home.join("AppData").join("Local");

    let mut fallbacks: Vec<PathBuf> = Vec::new();
    for cand in candidates {
        fallbacks.push(npm_dir.join(cand));
        fallbacks.push(local_bin.join(cand));
    }

    match cli_id {
        "claude" => {
            let npm_claude_exe = npm_dir.join(r"node_modules\@anthropic-ai\claude-code\bin\claude.exe");
            if npm_claude_exe.is_file() {
                fallbacks.insert(0, npm_claude_exe);
            }
            fallbacks.push(npm_dir.join("claude.cmd"));
            fallbacks.push(local_bin.join("claude.exe"));
            fallbacks.push(local_bin.join("hclaude.cmd"));
        }
        "codex" => {
            fallbacks.push(npm_dir.join("codex.cmd"));
            // OpenAI Codex 네이티브 런타임 바이너리 탐색
            let codex_bin_root = local_appdata.join("OpenAI").join("Codex").join("bin");
            if codex_bin_root.is_dir() {
                if let Ok(entries) = std::fs::read_dir(codex_bin_root) {
                    for entry in entries.flatten() {
                        let exe = entry.path().join("codex.exe");
                        if exe.is_file() {
                            fallbacks.insert(0, exe);
                        }
                    }
                }
            }
            fallbacks.push(local_bin.join("hcodex.cmd"));
        }
        "grok" => {
            fallbacks.push(home.join(".grok").join("bin").join("grok.exe"));
            fallbacks.push(local_bin.join("hgrok.cmd"));
        }
        "cursor" => {
            fallbacks.push(
                local_appdata
                    .join("Programs")
                    .join("cursor")
                    .join("resources")
                    .join("app")
                    .join("bin")
                    .join("cursor.cmd"),
            );
            fallbacks.push(home.join(".grok").join("bin").join("agent.exe"));
        }
        "antigravity" => {
            fallbacks.push(local_appdata.join("agy").join("bin").join("agy.exe"));
        }
        "opencode" => {
            fallbacks.push(npm_dir.join("opencode.cmd"));
        }
        _ => {}
    }

    for fb in fallbacks {
        if fb.is_file() {
            return Some(fb);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_clis_when_loaded_returns_all_target_clis_including_grok_and_opencode() {
        let clis = builtin_clis();
        let ids: Vec<&str> = clis.iter().map(|c| c.id.as_str()).collect();
        assert!(ids.contains(&"claude"));
        assert!(ids.contains(&"codex"));
        assert!(ids.contains(&"grok"));
        assert!(ids.contains(&"cursor"));
        assert!(ids.contains(&"antigravity"));
        assert!(ids.contains(&"opencode"));
    }

    #[test]
    fn resolve_cli_binary_when_empty_path_and_unknown_cli_returns_none() {
        let found = resolve_cli_binary("unknown_cli_xyz", &["nonexistent_bin_12345.exe".into()], "");
        assert!(found.is_none());
    }

    #[test]
    fn resolve_cli_binary_when_candidate_exists_in_temp_dir_returns_exact_path() {
        let temp_dir = std::env::temp_dir().join(format!("acm_cli_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let dummy_bin = temp_dir.join("mock-ai-cli.cmd");
        std::fs::write(&dummy_bin, "@echo off\r\necho hello\r\n").unwrap();

        let path_str = temp_dir.to_string_lossy().to_string();
        let resolved = resolve_cli_binary("custom", &["mock-ai-cli.cmd".into()], &path_str);
        assert_eq!(resolved, Some(dummy_bin));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
