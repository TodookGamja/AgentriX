use crate::db::{get_registry_items, record_backup, RegistryItem};
use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub item_id: String,
    pub cli_id: String,
    pub target_path: String,
    pub backup_path: Option<String>,
    pub status: String,
}

/// 로컬 PC의 ~/.claude.json, ~/.codex/config.toml, ~/.grok/config.toml, 각 CLI의 skills/ 및 plugins/ 폴더를 실측 스캔하여
/// 이미 설치해 사용 중인 MCP 서버, 스킬, 플러그인을 자동으로 레지스트리에 등록합니다.
pub fn discover_local_cli_extensions(conn: &Connection) -> Result<usize> {
    let home = crate::cli::home_dir();
    let now = Utc::now().to_rfc3339();
    let mut discovered_count = 0usize;

    // 기존 applied_clis 병합용 헬퍼
    let merge_item = |id: &str,
                      kind: &str,
                      name: &str,
                      desc: &str,
                      is_saver: i64,
                      cfg_json: &str,
                      cli_id: &str|
     -> Result<()> {
        let existing: Option<String> = conn
            .query_row(
                "SELECT applied_clis_json FROM registry_items WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();

        let mut applied_set: BTreeSet<String> = existing
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_default()
            .into_iter()
            .collect();
        if !cli_id.is_empty() {
            applied_set.insert(cli_id.to_string());
        }
        let applied_vec: Vec<String> = applied_set.into_iter().collect();
        let applied_str = serde_json::to_string(&applied_vec)?;

        conn.execute(
            "INSERT INTO registry_items
             (id, kind, name, description, enabled, is_token_saver, is_builtin, config_json, applied_clis_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, 0, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                applied_clis_json = excluded.applied_clis_json,
                updated_at = excluded.updated_at",
            params![id, kind, name, desc, is_saver, cfg_json, applied_str, now],
        )?;
        Ok(())
    };

    // 1. ~/.claude.json 내 mcpServers 스캔
    let claude_json_path = home.join(".claude.json");
    if claude_json_path.is_file() {
        if let Ok(raw) = std::fs::read_to_string(&claude_json_path) {
            if let Ok(val) = serde_json::from_str::<Value>(&raw) {
                if let Some(mcp_map) = val.get("mcpServers").and_then(|m| m.as_object()) {
                    for (srv_key, srv_val) in mcp_map {
                        let item_id = if srv_key.eq_ignore_ascii_case("headroom") {
                            "headroom-mcp".to_string()
                        } else {
                            format!("mcp-{}", srv_key)
                        };
                        let is_saver = if item_id == "headroom-mcp" { 1 } else { 0 };
                        let desc = if let Some(url) = srv_val.get("url").and_then(|u| u.as_str()) {
                            format!("로컬 감지된 원격 MCP 서버 ({})", url)
                        } else if let Some(cmd) = srv_val.get("command").and_then(|c| c.as_str()) {
                            format!("로컬 감지된 MCP 서버 (실행 명령: {})", cmd)
                        } else {
                            "Claude Code 설정에서 감지된 MCP 서버".to_string()
                        };
                        let cfg_str = serde_json::to_string_pretty(srv_val).unwrap_or_else(|_| "{}".into());
                        let display_name = if item_id == "headroom-mcp" {
                            "Headroom (Token Optimizer MCP & Proxy)".to_string()
                        } else {
                            format!("{} (MCP)", srv_key)
                        };
                        let _ = merge_item(&item_id, "mcp", &display_name, &desc, is_saver, &cfg_str, "claude");
                        discovered_count += 1;
                    }
                }
            }
        }
    }

    // 2. ~/.codex/config.toml 및 ~/.grok/config.toml 내 mcp_servers, plugins 스캔
    for (cli_id, toml_path) in [
        ("codex", home.join(".codex").join("config.toml")),
        ("grok", home.join(".grok").join("config.toml")),
    ] {
        if toml_path.is_file() {
            if let Ok(raw) = std::fs::read_to_string(&toml_path) {
                if let Ok(tbl) = toml::from_str::<toml::Table>(&raw) {
                    if let Some(mcp_tbl) = tbl.get("mcp_servers").and_then(|m| m.as_table()) {
                        for (srv_key, srv_val) in mcp_tbl {
                            let item_id = if srv_key.eq_ignore_ascii_case("headroom") {
                                "headroom-mcp".to_string()
                            } else {
                                format!("mcp-{}", srv_key)
                            };
                            let is_saver = if item_id == "headroom-mcp" { 1 } else { 0 };
                            let json_val = serde_json::to_value(srv_val).unwrap_or_else(|_| json!({}));
                            let cfg_str = serde_json::to_string_pretty(&json_val).unwrap_or_else(|_| "{}".into());
                            let desc = format!("{} config.toml에서 감지된 MCP 서버", cli_id.to_uppercase());
                            let display_name = if item_id == "headroom-mcp" {
                                "Headroom (Token Optimizer MCP & Proxy)".to_string()
                            } else {
                                format!("{} (MCP)", srv_key)
                            };
                            let _ = merge_item(&item_id, "mcp", &display_name, &desc, is_saver, &cfg_str, cli_id);
                            discovered_count += 1;
                        }
                    }

                    if let Some(plugins_tbl) = tbl.get("plugins").and_then(|p| p.as_table()) {
                        for (plug_key, plug_val) in plugins_tbl {
                            let enabled = plug_val
                                .get("enabled")
                                .and_then(|e| e.as_bool())
                                .unwrap_or(true);
                            if enabled {
                                let item_id = format!("plugin-{}", plug_key.replace('@', "-"));
                                let cfg_str = serde_json::to_string_pretty(&json!({
                                    "pluginName": plug_key,
                                    "sourceCli": cli_id,
                                    "enabled": enabled
                                }))
                                .unwrap_or_default();
                                let desc = format!("{}에 설치된 활성 플러그인 ({})", cli_id.to_uppercase(), plug_key);
                                let _ = merge_item(&item_id, "plugin", plug_key, &desc, 0, &cfg_str, cli_id);
                                discovered_count += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. ~/.claude/plugins/installed_plugins.json 스캔
    let claude_plugins_json = home
        .join(".claude")
        .join("plugins")
        .join("installed_plugins.json");
    if claude_plugins_json.is_file() {
        if let Ok(raw) = std::fs::read_to_string(&claude_plugins_json) {
            if let Ok(val) = serde_json::from_str::<Value>(&raw) {
                if let Some(plug_map) = val.get("plugins").and_then(|p| p.as_object()) {
                    for (plug_key, plug_arr) in plug_map {
                        let item_id = format!("plugin-{}", plug_key.replace('@', "-"));
                        let first_entry = plug_arr.as_array().and_then(|a| a.first()).cloned().unwrap_or_else(|| json!({}));
                        let ver = first_entry.get("version").and_then(|v| v.as_str()).unwrap_or("1.0.0");
                        let cfg_str = serde_json::to_string_pretty(&first_entry).unwrap_or_default();
                        let desc = format!("설치된 플러그인 v{} ({})", ver, plug_key);
                        let _ = merge_item(&item_id, "plugin", plug_key, &desc, 0, &cfg_str, "claude");
                        discovered_count += 1;
                    }
                }
            }
        }
    }

    // 4. 각 CLI의 skills 디렉터리 스캔 (~/.claude/skills, ~/.codex/skills, ~/.grok/skills, ~/.cursor/skills, ~/.gemini/config/skills)
    let skill_roots = vec![
        ("claude", home.join(".claude").join("skills")),
        ("codex", home.join(".codex").join("skills")),
        ("grok", home.join(".grok").join("skills")),
        ("cursor", home.join(".cursor").join("skills")),
        ("antigravity", home.join(".gemini").join("config").join("skills")),
        ("opencode", home.join(".config").join("opencode").join("skills")),
    ];

    let mut skill_clis: BTreeMap<String, (Vec<String>, String, String)> = BTreeMap::new();
    for (cli_id, root) in skill_roots {
        if !root.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path();
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.starts_with('.') || !path.is_dir() {
                    continue;
                }
                let skill_md_path = path.join("SKILL.md");
                if !skill_md_path.is_file() {
                    continue;
                }
                let md_raw = if skill_md_path.is_file() {
                    std::fs::read_to_string(&skill_md_path).unwrap_or_default()
                } else {
                    String::new()
                };
                let summary = extract_skill_description(&md_raw)
                    .unwrap_or_else(|| format!("로컬 설치된 '{}' 스킬 폴더", fname));

                let entry_ref = skill_clis
                    .entry(fname.clone())
                    .or_insert_with(|| (Vec::new(), summary, md_raw));
                if !entry_ref.0.contains(&cli_id.to_string()) {
                    entry_ref.0.push(cli_id.to_string());
                }
            }
        }
    }

    for (folder_name, (clis, summary, md_raw)) in skill_clis {
        let item_id = format!("skill-{}", folder_name);
        if md_raw.chars().count() > 600 {
            let old: Option<String> = conn.query_row(
                "SELECT config_json FROM registry_items WHERE id = ?1 AND kind = 'skill'",
                params![item_id], |row| row.get(0),
            ).ok();
            if let Some(mut old_cfg) = old.and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
                let preview: String = md_raw.chars().take(600).collect();
                if old_cfg.get("skillMarkdown").and_then(Value::as_str) == Some(preview.as_str()) {
                    old_cfg["skillMarkdown"] = json!(md_raw);
                    conn.execute("UPDATE registry_items SET config_json = ?1 WHERE id = ?2", params![old_cfg.to_string(), item_id])?;
                }
            }
        }
        let cfg_str = serde_json::to_string_pretty(&json!({
            "skillFolder": folder_name,
            "skillMarkdown": if md_raw.is_empty() {
                format!("# {}\n{}", folder_name, summary)
            } else {
                md_raw
            }
        }))
        .unwrap_or_default();

        for cid in clis {
            let _ = merge_item(
                &item_id,
                "skill",
                &format!("{} (Skill)", folder_name),
                &summary,
                0,
                &cfg_str,
                &cid,
            );
        }
        discovered_count += 1;
    }

    // 5. ~/.local/bin 내 독립 MCP 실행파일(mempalace-mcp.exe, graphify-mcp.exe 등) 스캔
    let local_bin = home.join(".local").join("bin");
    if local_bin.is_dir() {
        for (bin_name, display, desc) in [
            (
                "mempalace-mcp.exe",
                "MemPalace Memory MCP",
                "로컬 ~/.local/bin/mempalace-mcp.exe 기반 장기 기억/컨텍스트 그래프 MCP 서버",
            ),
            (
                "graphify-mcp.exe",
                "Graphify Codebase MCP",
                "로컬 ~/.local/bin/graphify-mcp.exe 기반 코드베이스 의존성 그래프 분석 MCP 서버",
            ),
        ] {
            let p = local_bin.join(bin_name);
            if p.is_file() {
                let item_id = format!("mcp-{}", bin_name.trim_end_matches(".exe"));
                let cfg_str = serde_json::to_string_pretty(&json!({
                    "command": p.to_string_lossy(),
                    "args": [],
                    "env": {}
                }))
                .unwrap_or_default();
                let _ = merge_item(&item_id, "mcp", display, desc, 0, &cfg_str, "");
                discovered_count += 1;
            }
        }
    }

    Ok(discovered_count)
}

fn extract_skill_description(md: &str) -> Option<String> {
    for line in md.lines().take(25) {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("description:") {
            let clean = rest.trim().trim_matches('"').trim_matches('\'');
            if !clean.is_empty() && clean != ">-" && clean != "|" {
                return Some(clean.to_string());
            }
        }
    }
    for line in md.lines().take(20) {
        let trimmed = line.trim();
        if !trimmed.is_empty()
            && !trimmed.starts_with("---")
            && !trimmed.starts_with("name:")
            && !trimmed.starts_with("description:")
            && !trimmed.starts_with('#')
        {
            return Some(trimmed.chars().take(120).collect());
        }
    }
    None
}

/// 기존 설정 파일 수정 전 항상 `.bak.<타임스탬프>` 백업을 생성하고 DB에 기록합니다.
pub fn backup_file_before_modify(
    conn: &Connection,
    cli_id: &str,
    target_path: &Path,
) -> Result<Option<PathBuf>> {
    if !target_path.exists() || !target_path.is_file() {
        return Ok(None);
    }

    let ts = Utc::now().format("%Y%m%d_%H%M%S_%3f").to_string();
    let file_name = target_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("config");
    let backup_name = format!("{}.bak.{}", file_name, ts);
    let backup_path = target_path.with_file_name(backup_name);

    std::fs::copy(target_path, &backup_path).with_context(|| {
        format!(
            "설정 파일 백업 실패: {:?} -> {:?}",
            target_path, backup_path
        )
    })?;

    record_backup(
        conn,
        cli_id,
        &target_path.to_string_lossy(),
        &backup_path.to_string_lossy(),
    )?;

    Ok(Some(backup_path))
}

pub fn apply_item_to_cli(
    conn: &Connection,
    item_id: &str,
    cli_id: &str,
) -> Result<ApplyResult> {
    let items = get_registry_items(conn)?;
    let mut item = items
        .into_iter()
        .find(|i| i.id == item_id)
        .ok_or_else(|| anyhow::anyhow!("레지스트리 항목을 찾을 수 없습니다: {}", item_id))?;

    let cli_def = crate::cli::detect_all_clis_with_db(conn)
        .into_iter()
        .find(|c| c.id == cli_id)
        .ok_or_else(|| anyhow::anyhow!("지원하지 않는 CLI ID입니다: {}", cli_id))?;

    let mut applied = item.applied_clis.clone();
    item.enabled = !applied.iter().any(|c| c == cli_id);
    let res = apply_item_to_paths(conn, &item, cli_id, &cli_def.config_path, &cli_def.skills_dir)?;
    if item.enabled {
        if !applied.iter().any(|c| c == cli_id) {
            applied.push(cli_id.to_string());
        }
    } else {
        applied.retain(|c| c != cli_id);
    }
    let applied_json = serde_json::to_string(&applied)?;
    conn.execute(
        "UPDATE registry_items SET applied_clis_json = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![applied_json, Utc::now().to_rfc3339(), item_id],
    )?;

    Ok(res)
}

pub fn apply_item_to_paths(
    conn: &Connection,
    item: &RegistryItem,
    cli_id: &str,
    config_path: &Path,
    skills_dir: &Path,
) -> Result<ApplyResult> {
    let cfg: Value = serde_json::from_str(&item.config_json).unwrap_or_else(|_| json!({}));

    match item.kind.as_str() {
        "mcp" => {
            if let Some(parent) = config_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let backup = backup_file_before_modify(conn, cli_id, config_path)?;

            let is_toml = config_path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("toml"))
                .unwrap_or(false);

            if cli_id == "opencode" {
                apply_mcp_to_opencode(config_path, &item.id, &cfg, item.enabled)?;
            } else if is_toml {
                apply_mcp_to_toml(config_path, &item.id, &cfg, item.enabled)?;
            } else {
                apply_mcp_to_json(config_path, &item.id, &cfg, item.enabled)?;
            }

            Ok(ApplyResult {
                item_id: item.id.clone(),
                cli_id: cli_id.to_string(),
                target_path: config_path.to_string_lossy().to_string(),
                backup_path: backup.map(|p| p.to_string_lossy().to_string()),
                status: if item.enabled {
                    "applied".into()
                } else {
                    "removed".into()
                },
            })
        }
        "skill" | "plugin" => {
            let folder_name = cfg
                .get("skillFolder")
                .or_else(|| cfg.get("pluginName"))
                .and_then(|v| v.as_str())
                .unwrap_or(&item.id);
            let safe_folder = folder_name.replace('@', "-").replace('/', "-");
            let target_dir = skills_dir.join(safe_folder);
            std::fs::create_dir_all(&target_dir)?;
            let skill_file = target_dir.join("SKILL.md");

            let backup = backup_file_before_modify(conn, cli_id, &skill_file)?;

            if item.enabled {
                let md_content = cfg
                    .get("skillMarkdown")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| {
                        format!(
                            "---\nname: {}\ndescription: {}\n---\n\n# {}\n\n{}\n",
                            item.id, item.description, item.name, item.description
                        )
                    });
                std::fs::write(&skill_file, md_content)?;
            } else if skill_file.exists() {
                std::fs::remove_file(&skill_file)?;
            }

            Ok(ApplyResult {
                item_id: item.id.clone(),
                cli_id: cli_id.to_string(),
                target_path: skill_file.to_string_lossy().to_string(),
                backup_path: backup.map(|p| p.to_string_lossy().to_string()),
                status: if item.enabled {
                    "applied".into()
                } else {
                    "removed".into()
                },
            })
        }
        other => anyhow::bail!("알 수 없는 레지스트리 유형입니다: {}", other),
    }
}

fn apply_mcp_to_opencode(path: &Path, server_id: &str, cfg: &Value, enabled: bool) -> Result<()> {
    let mut root: Value = if path.exists() {
        serde_json::from_str(&std::fs::read_to_string(path)?)?
    } else {
        json!({})
    };
    let root_obj = root.as_object_mut().ok_or_else(|| anyhow::anyhow!("OpenCode config must be a JSON object"))?;
    let mcp = root_obj.entry("mcp").or_insert_with(|| json!({}));
    let servers = mcp.as_object_mut().ok_or_else(|| anyhow::anyhow!("OpenCode mcp must be a JSON object"))?;
    if enabled {
        let entry = if let Some(url) = cfg.get("url").and_then(Value::as_str) {
            let mut entry = json!({"type": "remote", "url": url, "enabled": true});
            if let Some(headers) = cfg.get("headers") { entry["headers"] = headers.clone(); }
            entry
        } else {
            let command = cfg.get("command").and_then(Value::as_str).ok_or_else(|| anyhow::anyhow!("MCP command is required"))?;
            let mut args = vec![json!(command)];
            if let Some(extra) = cfg.get("args").and_then(Value::as_array) { args.extend(extra.iter().cloned()); }
            json!({"type": "local", "command": args, "environment": cfg.get("env").cloned().unwrap_or_else(|| json!({})), "enabled": true})
        };
        servers.insert(server_id.to_string(), entry);
    } else if servers.remove(server_id).is_none() {
        let name = if server_id == "headroom-mcp" { Some("headroom") } else { server_id.strip_prefix("mcp-") };
        if let Some(name) = name { servers.remove(name); }
    }
    std::fs::write(path, serde_json::to_string_pretty(&root)?)?;
    Ok(())
}

fn apply_mcp_to_json(path: &Path, server_id: &str, cfg: &Value, enabled: bool) -> Result<()> {
    let mut root: Value = if path.exists() {
        let raw = std::fs::read_to_string(path)?;
        serde_json::from_str(&raw)?
    } else {
        json!({})
    };

    anyhow::ensure!(root.is_object(), "MCP config must be a JSON object");

    let root_obj = root.as_object_mut().unwrap();
    let mcp_servers = root_obj
        .entry("mcpServers")
        .or_insert_with(|| json!({}));
    anyhow::ensure!(mcp_servers.is_object(), "mcpServers must be a JSON object");

    let servers_map = mcp_servers.as_object_mut().unwrap();
    if enabled {
        let cmd = cfg.get("command").and_then(|v| v.as_str()).unwrap_or("npx");
        let args = cfg.get("args").cloned().unwrap_or_else(|| json!([]));
        let env = cfg.get("env").cloned().unwrap_or_else(|| json!({}));
        servers_map.insert(
            server_id.to_string(),
            json!({
                "command": cmd,
                "args": args,
                "env": env
            }),
        );
    } else {
        if servers_map.remove(server_id).is_none() {
            let discovered_name = if server_id == "headroom-mcp" { Some("headroom") } else { server_id.strip_prefix("mcp-") };
            if let Some(name) = discovered_name { servers_map.remove(name); }
        }
    }

    let formatted = serde_json::to_string_pretty(&root)?;
    std::fs::write(path, formatted)?;
    Ok(())
}

fn apply_mcp_to_toml(path: &Path, server_id: &str, cfg: &Value, enabled: bool) -> Result<()> {
    let mut root_table: toml::Table = if path.exists() {
        let raw = std::fs::read_to_string(path)?;
        toml::from_str(&raw)?
    } else {
        toml::Table::new()
    };

    let mcp_entry = root_table
        .entry("mcp_servers")
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));

    anyhow::ensure!(mcp_entry.is_table(), "mcp_servers must be a TOML table");

    let servers_table = mcp_entry.as_table_mut().unwrap();
    if enabled {
        let mut srv = toml::Table::new();
        let cmd = cfg.get("command").and_then(|v| v.as_str()).unwrap_or("npx");
        srv.insert("command".into(), toml::Value::String(cmd.to_string()));

        let mut toml_args = Vec::new();
        if let Some(arr) = cfg.get("args").and_then(|v| v.as_array()) {
            for a in arr {
                if let Some(s) = a.as_str() {
                    toml_args.push(toml::Value::String(s.to_string()));
                }
            }
        }
        srv.insert("args".into(), toml::Value::Array(toml_args));

        if let Some(env_obj) = cfg.get("env").and_then(|v| v.as_object()) {
            let mut env_tbl = toml::Table::new();
            for (k, v) in env_obj {
                if let Some(s) = v.as_str() {
                    env_tbl.insert(k.clone(), toml::Value::String(s.to_string()));
                }
            }
            srv.insert("env".into(), toml::Value::Table(env_tbl));
        }

        servers_table.insert(server_id.to_string(), toml::Value::Table(srv));
    } else {
        if servers_table.remove(server_id).is_none() {
            let discovered_name = if server_id == "headroom-mcp" { Some("headroom") } else { server_id.strip_prefix("mcp-") };
            if let Some(name) = discovered_name { servers_table.remove(name); }
        }
    }

    let serialized = toml::to_string_pretty(&root_table)?;
    std::fs::write(path, serialized)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{get_backups, setup_schema};

    #[test]
    fn opencode_mcp_uses_native_format_and_preserves_other_settings() {
        let dir = std::env::temp_dir().join(format!("acm_opencode_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("opencode.json");
        std::fs::write(&path, r#"{"model":"provider/model","mcp":{"other":{"type":"remote","url":"https://example.com"}}}"#).unwrap();
        apply_mcp_to_opencode(&path, "headroom-mcp", &json!({"command":"headroom","args":["mcp","serve"],"env":{"A":"B"}}), true).unwrap();
        let result: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(result["model"], "provider/model");
        assert_eq!(result["mcp"]["headroom-mcp"]["command"], json!(["headroom", "mcp", "serve"]));
        assert_eq!(result["mcp"]["headroom-mcp"]["environment"]["A"], "B");
        apply_mcp_to_opencode(&path, "headroom-mcp", &json!({}), false).unwrap();
        let result: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(result["mcp"].get("headroom-mcp").is_none());
        assert!(result["mcp"].get("other").is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_mcp_configs_are_not_overwritten() {
        let dir = std::env::temp_dir().join(format!("acm_invalid_mcp_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let json_path = dir.join("config.json");
        let toml_path = dir.join("config.toml");
        std::fs::write(&json_path, "{invalid").unwrap();
        std::fs::write(&toml_path, "[invalid").unwrap();
        assert!(apply_mcp_to_json(&json_path, "test", &json!({}), true).is_err());
        assert!(apply_mcp_to_toml(&toml_path, "test", &json!({}), true).is_err());
        assert_eq!(std::fs::read_to_string(&json_path).unwrap(), "{invalid");
        assert_eq!(std::fs::read_to_string(&toml_path).unwrap(), "[invalid");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn remove_discovered_server_by_its_original_name() {
        let dir = std::env::temp_dir().join(format!("acm_remove_mcp_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let json_path = dir.join("config.json");
        let toml_path = dir.join("config.toml");
        std::fs::write(&json_path, r#"{"mcpServers":{"example":{"command":"test"},"other":{}}}"#).unwrap();
        std::fs::write(&toml_path, "[mcp_servers.example]\ncommand = 'test'\n[mcp_servers.other]\n").unwrap();
        apply_mcp_to_json(&json_path, "mcp-example", &json!({}), false).unwrap();
        apply_mcp_to_toml(&toml_path, "mcp-example", &json!({}), false).unwrap();
        let json: Value = serde_json::from_str(&std::fs::read_to_string(&json_path).unwrap()).unwrap();
        let toml: toml::Table = toml::from_str(&std::fs::read_to_string(&toml_path).unwrap()).unwrap();
        assert!(json["mcpServers"].get("example").is_none());
        assert!(json["mcpServers"].get("other").is_some());
        assert!(toml["mcp_servers"].get("example").is_none());
        assert!(toml["mcp_servers"].get("other").is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn apply_mcp_to_json_when_existing_claude_config_creates_backup_and_preserves_existing_keys() {
        let conn = Connection::open_in_memory().unwrap();
        setup_schema(&conn).unwrap();

        let temp_dir = std::env::temp_dir().join(format!("acm_mcp_json_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let claude_json = temp_dir.join(".claude.json");
        let skills_dir = temp_dir.join("skills");

        std::fs::write(
            &claude_json,
            r#"{"theme":"dark","hasCompletedOnboarding":true}"#,
        )
        .unwrap();

        let item = RegistryItem {
            id: "headroom-mcp".into(),
            kind: "mcp".into(),
            name: "Headroom".into(),
            description: "Token optimizer".into(),
            enabled: true,
            is_token_saver: true,
            is_builtin: true,
            config_json: r#"{"command":"npx","args":["-y","@headroom-ai/mcp-server"],"env":{"HEADROOM_MODE":"fast"}}"#.into(),
            applied_clis: vec![],
            updated_at: Utc::now().to_rfc3339(),
        };

        let result = apply_item_to_paths(&conn, &item, "claude", &claude_json, &skills_dir).unwrap();
        assert!(result.backup_path.is_some());
        let backup_file = PathBuf::from(result.backup_path.unwrap());
        assert!(backup_file.exists());

        let backups = get_backups(&conn).unwrap();
        assert_eq!(backups.len(), 1);

        let updated: Value = serde_json::from_str(&std::fs::read_to_string(&claude_json).unwrap()).unwrap();
        assert_eq!(updated.get("theme").and_then(|v| v.as_str()), Some("dark"));
        assert!(updated
            .get("mcpServers")
            .and_then(|m| m.get("headroom-mcp"))
            .is_some());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn apply_mcp_to_toml_when_codex_config_writes_valid_mcp_servers_table_and_backups() {
        let conn = Connection::open_in_memory().unwrap();
        setup_schema(&conn).unwrap();

        let temp_dir = std::env::temp_dir().join(format!("acm_mcp_toml_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let codex_toml = temp_dir.join("config.toml");
        let skills_dir = temp_dir.join("skills");

        std::fs::write(&codex_toml, "model = \"gpt-5-codex\"\n").unwrap();

        let item = RegistryItem {
            id: "headroom-mcp".into(),
            kind: "mcp".into(),
            name: "Headroom".into(),
            description: "Token optimizer".into(),
            enabled: true,
            is_token_saver: true,
            is_builtin: true,
            config_json: r#"{"command":"npx","args":["-y","@headroom-ai/mcp-server"]}"#.into(),
            applied_clis: vec![],
            updated_at: Utc::now().to_rfc3339(),
        };

        let res = apply_item_to_paths(&conn, &item, "codex", &codex_toml, &skills_dir).unwrap();
        assert!(res.backup_path.is_some());

        let raw_toml = std::fs::read_to_string(&codex_toml).unwrap();
        assert!(raw_toml.contains("model = \"gpt-5-codex\""));
        assert!(raw_toml.contains("[mcp_servers.headroom-mcp]"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn apply_skill_when_caveman_enabled_creates_skill_md_and_removes_when_disabled() {
        let conn = Connection::open_in_memory().unwrap();
        setup_schema(&conn).unwrap();

        let temp_dir = std::env::temp_dir().join(format!("acm_skill_test_{}", uuid::Uuid::new_v4()));
        let config_path = temp_dir.join(".claude.json");
        let skills_dir = temp_dir.join("skills");

        let mut item = RegistryItem {
            id: "caveman-skill".into(),
            kind: "skill".into(),
            name: "Caveman".into(),
            description: "Concise output skill".into(),
            enabled: true,
            is_token_saver: true,
            is_builtin: true,
            config_json: r##"{"skillFolder":"caveman","skillMarkdown":"# Caveman Skill\nBe concise."}"##.into(),
            applied_clis: vec![],
            updated_at: Utc::now().to_rfc3339(),
        };

        let res1 = apply_item_to_paths(&conn, &item, "claude", &config_path, &skills_dir).unwrap();
        let skill_path = PathBuf::from(&res1.target_path);
        assert!(skill_path.exists());

        item.enabled = false;
        let res2 = apply_item_to_paths(&conn, &item, "claude", &config_path, &skills_dir).unwrap();
        assert!(res2.backup_path.is_some());
        assert!(!skill_path.exists());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn discover_local_cli_extensions_when_run_imports_mcp_skills_and_plugins_into_registry() {
        let conn = Connection::open_in_memory().unwrap();
        setup_schema(&conn).unwrap();

        let count = discover_local_cli_extensions(&conn).unwrap();
        let items = get_registry_items(&conn).unwrap();
        assert!(count >= items.len());
    }
}
