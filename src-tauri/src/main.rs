#![windows_subsystem = "windows"]


pub mod cli;
pub mod context;
pub mod db;
pub mod handoff;
pub mod tools;
pub mod mcp;
pub mod pty;
pub mod team_mail;
pub mod usage;

use cli::CliDefinition;
use db::{
    init_db, ApiKeyStatus, BackupRecord, CustomCliInput, ProjectAgentInput, ProjectAgentRecord,
    ProjectAnalysisResult, ProjectFolderRecord, RegistryItem, TeamMemberRecord, UsageDashboardData,
};
use mcp::ApplyResult;
use pty::{PtyManager, PtyOutputChunk, SessionInfo};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};

pub struct AppState {
    pub pty: PtyManager,
    pub db: Arc<Mutex<rusqlite::Connection>>,
}

#[tauri::command]
fn detect_clis(state: State<'_, AppState>) -> Result<Vec<CliDefinition>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(cli::detect_all_clis_with_db(&conn))
}

#[tauri::command]
fn add_custom_cli(
    state: State<'_, AppState>,
    input: CustomCliInput,
) -> Result<Vec<CliDefinition>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_custom_cli(&conn, &input).map_err(|e| e.to_string())?;
    Ok(cli::detect_all_clis_with_db(&conn))
}

#[tauri::command]
fn delete_custom_cli(
    state: State<'_, AppState>,
    cli_id: String,
) -> Result<Vec<CliDefinition>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_custom_cli(&conn, &cli_id).map_err(|e| e.to_string())?;
    Ok(cli::detect_all_clis_with_db(&conn))
}

#[tauri::command]
fn get_project_folders(state: State<'_, AppState>) -> Result<Vec<ProjectFolderRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_project_folders(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_project_folder(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<ProjectFolderRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_project_folder(&conn, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_project_folder(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<ProjectFolderRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_project_folder(&conn, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn reset_app_data(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::reset_all_user_data(&conn).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn apply_dialog_theme_mode(theme: Option<&str>, hwnd_opt: Option<*mut std::ffi::c_void>) {
    unsafe {
        extern "system" {
            fn LoadLibraryA(lpLibFileName: *const u8) -> *mut std::ffi::c_void;
            fn GetProcAddress(hModule: *mut std::ffi::c_void, lpProcName: *const u8) -> *mut std::ffi::c_void;
        }

        let is_dark = matches!(theme, Some("dark"));
        let mode = match theme {
            Some("light") => 3, // ForceLight
            Some("dark") => 2,  // ForceDark
            _ => 0,             // Default
        };

        // 1. DwmSetWindowAttribute & AllowDarkModeForWindow for parent window if available
        if let Some(hwnd) = hwnd_opt {
            let dwmapi = LoadLibraryA(b"dwmapi.dll\0".as_ptr());
            if !dwmapi.is_null() {
                let proc_dwm = GetProcAddress(dwmapi, b"DwmSetWindowAttribute\0".as_ptr());
                if !proc_dwm.is_null() {
                    let set_dwm: extern "system" fn(*mut std::ffi::c_void, u32, *const i32, u32) -> i32 =
                        std::mem::transmute(proc_dwm);
                    let use_dark: i32 = if is_dark { 1 } else { 0 };
                    // DWMWA_USE_IMMERSIVE_DARK_MODE = 20
                    set_dwm(hwnd, 20, &use_dark, 4);
                }
            }

            let uxtheme_w = LoadLibraryA(b"uxtheme.dll\0".as_ptr());
            if !uxtheme_w.is_null() {
                // Ordinal 133: AllowDarkModeForWindow
                let proc133 = GetProcAddress(uxtheme_w, 133 as *const u8);
                if !proc133.is_null() {
                    let allow_window: extern "system" fn(*mut std::ffi::c_void, bool) -> bool =
                        std::mem::transmute(proc133);
                    allow_window(hwnd, is_dark);
                }
            }
        }

        // 2. uxtheme.dll hook
        let uxtheme = LoadLibraryA(b"uxtheme.dll\0".as_ptr());
        if !uxtheme.is_null() {
            // Ordinal 135: SetPreferredAppMode (Windows 10 1903+)
            let proc135 = GetProcAddress(uxtheme, 135 as *const u8);
            if !proc135.is_null() {
                let set_preferred_app_mode: extern "system" fn(i32) -> i32 = std::mem::transmute(proc135);
                set_preferred_app_mode(mode);
            }

            // Ordinal 104: RefreshImmersiveColorPolicyState (CRITICAL for instant policy refresh)
            let proc104 = GetProcAddress(uxtheme, 104 as *const u8);
            if !proc104.is_null() {
                let refresh_policy: extern "system" fn() = std::mem::transmute(proc104);
                refresh_policy();
            }

            // Ordinal 132: AllowDarkModeForApp (Windows 10 1809)
            let proc132 = GetProcAddress(uxtheme, 132 as *const u8);
            if !proc132.is_null() {
                let allow_dark_mode: extern "system" fn(bool) -> bool = std::mem::transmute(proc132);
                allow_dark_mode(is_dark);
            }

            // Ordinal 136: FlushMenuThemes
            let proc136 = GetProcAddress(uxtheme, 136 as *const u8);
            if !proc136.is_null() {
                let flush_menu_themes: extern "system" fn() = std::mem::transmute(proc136);
                flush_menu_themes();
            }
        }
    }
}

#[tauri::command]
fn set_app_theme_mode(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd_raw = window.hwnd().ok().map(|h| h.0 as *mut std::ffi::c_void);
        apply_dialog_theme_mode(Some(&theme), hwnd_raw);
    }
    Ok(())
}

#[tauri::command]
fn pick_project_folder(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    theme: Option<String>,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd_raw = window.hwnd().ok().map(|h| h.0 as *mut std::ffi::c_void);
        apply_dialog_theme_mode(theme.as_deref(), hwnd_raw);
    }

    let folder = rfd::FileDialog::new()
        .set_title("AgentriX - 작업 프로젝트 폴더 선택")
        .set_parent(&window)
        .pick_folder();

    if let Some(path) = folder {
        let selected = path.to_string_lossy().to_string();
        if let Ok(conn) = state.db.lock() {
            let _ = db::upsert_project_folder(&conn, &selected);
        }
        Ok(Some(selected))
    } else {
        Ok(None)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_hidden: bool,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickAccessItem {
    pub name: String,
    pub path: String,
    pub kind: String, // "home", "desktop", "documents", "downloads", "pictures", "drive", "project"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryListing {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub items: Vec<DirectoryItem>,
    pub quick_access: Vec<QuickAccessItem>,
}

#[tauri::command]
fn list_directory_entries(
    state: State<'_, AppState>,
    path: Option<String>,
    include_files: Option<bool>,
) -> Result<DirectoryListing, String> {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users".into());
    let default_root = if std::path::Path::new(&user_profile).exists() {
        user_profile.clone()
    } else {
        "C:\\".into()
    };

    let target_path_str = match path {
        Some(p) if !p.trim().is_empty() => p.trim().to_string(),
        _ => default_root,
    };

    let target_path = std::path::PathBuf::from(&target_path_str);
    let resolved_path = if target_path.exists() {
        target_path
    } else {
        std::path::PathBuf::from(&user_profile)
    };

    let parent_path = resolved_path.parent().map(|p| p.to_string_lossy().to_string());
    let should_include_files = include_files.unwrap_or(false);

    let mut items = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&resolved_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            let is_dir = p.is_dir();
            if !is_dir && !should_include_files {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            let is_hidden = file_name.starts_with('.') || file_name.starts_with('$');
            let ext = if !is_dir {
                p.extension().map(|e| e.to_string_lossy().to_string().to_lowercase())
            } else {
                None
            };
            let size = if !is_dir {
                entry.metadata().ok().map(|m| m.len())
            } else {
                None
            };
            items.push(DirectoryItem {
                name: file_name,
                path: p.to_string_lossy().to_string(),
                is_dir,
                is_hidden,
                size,
                extension: ext,
            });
        }
    }
    items.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => match (a.is_hidden, b.is_hidden) {
                (true, false) => std::cmp::Ordering::Greater,
                (false, true) => std::cmp::Ordering::Less,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            },
        }
    });

    let mut quick_access = Vec::new();

    let desktop = std::path::Path::new(&user_profile).join("Desktop");
    if desktop.exists() {
        quick_access.push(QuickAccessItem {
            name: "바탕 화면".into(),
            path: desktop.to_string_lossy().to_string(),
            kind: "desktop".into(),
        });
    }

    let pictures = std::path::Path::new(&user_profile).join("Pictures");
    if pictures.exists() {
        quick_access.push(QuickAccessItem {
            name: "사진".into(),
            path: pictures.to_string_lossy().to_string(),
            kind: "pictures".into(),
        });
    }

    let documents = std::path::Path::new(&user_profile).join("Documents");
    if documents.exists() {
        quick_access.push(QuickAccessItem {
            name: "문서".into(),
            path: documents.to_string_lossy().to_string(),
            kind: "documents".into(),
        });
    }

    let downloads = std::path::Path::new(&user_profile).join("Downloads");
    if downloads.exists() {
        quick_access.push(QuickAccessItem {
            name: "다운로드".into(),
            path: downloads.to_string_lossy().to_string(),
            kind: "downloads".into(),
        });
    }

    quick_access.push(QuickAccessItem {
        name: "사용자 홈".into(),
        path: user_profile,
        kind: "home".into(),
    });

    #[cfg(target_os = "windows")]
    {
        for letter in b'C'..=b'Z' {
            let drive_path = format!("{}:\\", letter as char);
            if std::path::Path::new(&drive_path).exists() {
                quick_access.push(QuickAccessItem {
                    name: format!("드라이브 ({}:)", letter as char),
                    path: drive_path,
                    kind: "drive".into(),
                });
            }
        }
    }

    if let Ok(conn) = state.db.lock() {
        if let Ok(recent) = db::get_project_folders(&conn) {
            for proj in recent.into_iter().take(5) {
                if !quick_access.iter().any(|q| q.path.eq_ignore_ascii_case(&proj.path)) {
                    quick_access.push(QuickAccessItem {
                        name: proj.name,
                        path: proj.path,
                        kind: "project".into(),
                    });
                }
            }
        }
    }

    Ok(DirectoryListing {
        current_path: resolved_path.to_string_lossy().to_string(),
        parent_path,
        items,
        quick_access,
    })
}

#[tauri::command]
fn get_project_agents(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Vec<ProjectAgentRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_project_agents(&conn, &project_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn upsert_project_agent(
    state: State<'_, AppState>,
    input: ProjectAgentInput,
) -> Result<Vec<ProjectAgentRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_project_agent(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_project_agent(
    state: State<'_, AppState>,
    project_path: String,
    agent_id: String,
) -> Result<Vec<ProjectAgentRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_project_agent(&conn, &project_path, &agent_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn seed_project_agents_preset(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Vec<ProjectAgentRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::seed_project_agents_preset(&conn, &project_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_project_blackboard(project_path: String) -> Result<String, String> {
    db::get_project_blackboard(&project_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn route_team_mail(state: State<'_, AppState>, project_path: String) -> Result<Vec<team_mail::InboxMessage>, String> {
    if db::is_forbidden_system_dir(&project_path) || !std::path::Path::new(&project_path).is_dir() {
        return Err("Invalid project directory".into());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let agents = db::get_project_agents(&conn, &project_path).map_err(|e| e.to_string())?;
    let roster = agents.into_iter().map(|a| (a.id, a.name)).collect::<Vec<_>>();
    team_mail::route(std::path::Path::new(&project_path), &roster)
}

#[tauri::command]
fn acknowledge_team_mail(state: State<'_, AppState>, project_path: String, agent_id: String, message_id: String) -> Result<(), String> {
    if db::is_forbidden_system_dir(&project_path) || !std::path::Path::new(&project_path).is_dir() {
        return Err("Invalid project directory".into());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let agents = db::get_project_agents(&conn, &project_path).map_err(|e| e.to_string())?;
    if !agents.iter().any(|a| a.id == agent_id) { return Err("Unknown agent".into()); }
    team_mail::acknowledge(std::path::Path::new(&project_path), &agent_id, &message_id)
}

#[tauri::command]
fn save_project_blackboard(project_path: String, content: String) -> Result<(), String> {
    db::save_project_blackboard(&project_path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_session_handoff(
    project_path: String,
    filename: Option<String>,
    content: String,
) -> Result<String, String> {
    let safe_path = handoff::validate_safe_handoff_path(&project_path, filename.as_deref())?;
    if let Some(parent) = safe_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let redacted = handoff::redact_secrets(&content);
    std::fs::write(&safe_path, &redacted).map_err(|e| e.to_string())?;
    Ok(safe_path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_clipboard_image(
    project_path: Option<String>,
    base64_data: String,
    ext: Option<String>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let clean_b64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let bytes = B64.decode(clean_b64.trim()).map_err(|e| format!("Base64 디코딩 실패: {}", e))?;

    let file_ext = ext.unwrap_or_else(|| "png".to_string());
    let filename = format!("pasted_image_{}.{}", chrono::Utc::now().format("%Y%m%d_%H%M%S_%3f"), file_ext);

    let target_dir = if let Some(ref p) = project_path {
        let p_obj = std::path::Path::new(p);
        if p_obj.exists() && p_obj.is_dir() {
            let attach_dir = p_obj.join(".attachments");
            let _ = std::fs::create_dir_all(&attach_dir);
            attach_dir
        } else {
            dirs::data_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("AI_CLI_Manager")
                .join("pasted_images")
        }
    } else {
        dirs::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("AI_CLI_Manager")
            .join("pasted_images")
    };

    std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let file_path = target_dir.join(&filename);
    std::fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_file_as_base64(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let file_path = std::path::Path::new(&path);
    if !file_path.exists() || !file_path.is_file() {
        return Err("파일을 찾을 수 없습니다.".into());
    }
    let metadata = std::fs::metadata(file_path).map_err(|e| e.to_string())?;
    if metadata.len() > 15 * 1024 * 1024 {
        return Err("파일 크기가 15MB를 초과하여 미리보기를 지원하지 않습니다.".into());
    }
    let bytes = std::fs::read(file_path).map_err(|e| e.to_string())?;
    let ext = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_string().to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    };
    let b64 = B64.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
fn analyze_project_workspace(project_path: String) -> Result<ProjectAnalysisResult, String> {
    db::analyze_project_workspace(&project_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_project_deep_context(project_path: String) -> Result<db::ProjectDeepContext, String> {
    db::get_project_deep_context(&project_path).map_err(|e| e.to_string())
}

fn run_quiet(prog: &str, args: &[&str], dir: Option<&std::path::Path>) -> Option<String> {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("cmd.exe");
        c.args(["/D", "/C", prog]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = std::process::Command::new(prog);
    cmd.args(args);
    if let Some(d) = dir { cmd.current_dir(d); }
    let out = cmd.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

/// 설치된 Claude 플러그인의 마켓플레이스 저장소를 fetch해 설치 버전보다 새 버전이 있는지 확인
#[tauri::command]
async fn check_plugin_updates() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let dir = dirs::home_dir().ok_or("홈 디렉터리를 찾을 수 없습니다.")?.join(".claude").join("plugins");
        let read = |f: &str| -> serde_json::Value {
            std::fs::read_to_string(dir.join(f)).ok().and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default()
        };
        let (installed, markets) = (read("installed_plugins.json"), read("known_marketplaces.json"));
        let mut result = serde_json::Map::new();
        let mut fetched = std::collections::HashSet::new();
        for (key, entries) in installed.get("plugins").and_then(|p| p.as_object()).into_iter().flatten() {
            let Some((name, market)) = key.split_once('@') else { continue };
            let Some(cur) = entries.get(0).and_then(|e| e.get("version")).and_then(|v| v.as_str()) else { continue };
            let Some(loc) = markets.get(market).and_then(|m| m.get("installLocation")).and_then(|v| v.as_str()) else { continue };
            let loc = std::path::PathBuf::from(loc);
            if fetched.insert(market.to_string()) { run_quiet("git", &["fetch", "--quiet"], Some(&loc)); }
            let show = |path: &str| run_quiet("git", &["show", &format!("@{{u}}:{path}")], Some(&loc)).and_then(|r| serde_json::from_str::<serde_json::Value>(&r).ok());
            let Some(cat) = show(".claude-plugin/marketplace.json") else { continue };
            let Some(entry) = cat.get("plugins").and_then(|p| p.as_array()).and_then(|a| a.iter().find(|p| p.get("name").and_then(|n| n.as_str()) == Some(name))) else { continue };
            // 카탈로그에 버전이 없으면 플러그인 자체의 plugin.json 버전을 사용
            let latest = entry.get("version").and_then(|v| v.as_str()).map(String::from).or_else(|| {
                let src = entry.get("source").and_then(|s| s.as_str())?.trim_start_matches("./").trim_end_matches('/');
                let path = if src.is_empty() { ".claude-plugin/plugin.json".to_string() } else { format!("{src}/.claude-plugin/plugin.json") };
                show(&path)?.get("version")?.as_str().map(String::from)
            });
            // ponytail: 문자열 비교 대신 is_newer_version 재사용
            if let Some(latest) = latest { if is_newer_version(&latest, cur) { result.insert(key.clone(), serde_json::json!({"current": cur, "latest": latest})); } }
        }
        Ok(serde_json::Value::Object(result))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_plugin(plugin: String) -> Result<(), String> {
    if !plugin.bytes().all(|b| b.is_ascii_alphanumeric() || b"@._-".contains(&b)) { return Err("잘못된 플러그인 이름입니다.".into()); }
    tauri::async_runtime::spawn_blocking(move || run_quiet("claude", &["plugin", "update", &plugin], None).map(|_| ()).ok_or_else(|| "플러그인 업데이트 실패".to_string()))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_npm_cli_updates() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        let mut cmd = {
            use std::os::windows::process::CommandExt;
            let mut cmd = std::process::Command::new("cmd.exe");
            cmd.args(["/D", "/C", "npm.cmd"]);
            cmd.creation_flags(0x08000000);
            cmd
        };
        #[cfg(not(windows))]
        let mut cmd = std::process::Command::new("npm");
        let output = cmd.args(["outdated", "-g", "--json"]).output().map_err(|e| format!("npm 실행 실패: {e}"))?;
        if !output.status.success() && output.status.code() != Some(1) {
            return Err(format!("업데이트 확인 실패: {}", String::from_utf8_lossy(&output.stderr)));
        }
        if !output.status.success() && output.stdout.iter().all(u8::is_ascii_whitespace) {
            return Err(format!("업데이트 확인 실패: {}", String::from_utf8_lossy(&output.stderr)));
        }
        let parsed: serde_json::Value = if output.stdout.iter().all(u8::is_ascii_whitespace) {
            serde_json::json!({})
        } else {
            serde_json::from_slice(&output.stdout).map_err(|e| format!("npm 결과 확인 실패: {e}"))?
        };
        if let Some(error) = parsed.get("error") { return Err(format!("npm 오류: {error}")); }
        Ok(npm_cli_updates(&parsed))
    }).await.map_err(|e| e.to_string())?
}

const NPM_CLIS: [&str; 5] = ["@openai/codex", "@anthropic-ai/claude-code", "opencode-ai", "@xai/grok-cli", "@google/gemini-cli"];

#[tauri::command]
async fn install_npm_cli_update(package: String) -> Result<(), String> {
    if !NPM_CLIS.contains(&package.as_str()) {
        return Err("지원하지 않는 npm CLI입니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        let mut cmd = {
            use std::os::windows::process::CommandExt;
            let mut cmd = std::process::Command::new("cmd.exe");
            cmd.args(["/D", "/C", "npm.cmd"]);
            cmd.creation_flags(0x08000000);
            cmd
        };
        #[cfg(not(windows))]
        let mut cmd = std::process::Command::new("npm");
        let output = cmd.args(["install", "-g", &format!("{package}@latest")]).output()
            .map_err(|e| format!("npm 실행 실패: {e}"))?;
        if !output.status.success() {
            return Err(format!("설치 실패: {}", String::from_utf8_lossy(&output.stderr)));
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

fn npm_cli_updates(parsed: &serde_json::Value) -> serde_json::Value {
    let mut updates = serde_json::Map::new();
    for package in NPM_CLIS {
        if let Some(value) = parsed.get(package) { updates.insert(package.to_string(), value.clone()); }
    }
    serde_json::Value::Object(updates)
}

#[cfg(test)]
#[test]
fn npm_updates_only_include_supported_clis() {
    let result = npm_cli_updates(&serde_json::json!({"opencode-ai": {"current": "1.0", "latest": "2.0"}, "unrelated": {"current": "1"}}));
    assert_eq!(result["opencode-ai"]["latest"], "2.0");
    assert!(result.get("unrelated").is_none());
}

#[test]
fn npm_update_rejects_unsupported_package() {
    let result = tauri::async_runtime::block_on(install_npm_cli_update("unrelated;command".into()));
    assert!(result.is_err());
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedCliCredential {
    pub cli_id: String,
    pub provider: String,
    pub key_name: String,
    pub raw_key: String,
    pub source: String,
}

#[tauri::command]
fn get_detected_cli_credentials(state: State<'_, AppState>) -> Result<Vec<DetectedCliCredential>, String> {
    let mut results = Vec::new();

    // 1. 환경변수 스캔
    let env_candidates = [
        ("claude", "anthropic", "ANTHROPIC_API_KEY", "시스템 환경변수"),
        ("codex", "openai", "OPENAI_API_KEY", "시스템 환경변수"),
        ("antigravity", "gemini", "GEMINI_API_KEY", "시스템 환경변수"),
        ("antigravity", "gemini", "GOOGLE_API_KEY", "시스템 환경변수"),
        ("grok", "groq", "GROQ_API_KEY", "시스템 환경변수"),
        ("grok", "groq", "XAI_API_KEY", "시스템 환경변수"),
    ];

    for (cli_id, provider, env_var, source) in env_candidates {
        if let Ok(val) = std::env::var(env_var) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                results.push(DetectedCliCredential {
                    cli_id: cli_id.to_string(),
                    provider: provider.to_string(),
                    key_name: env_var.to_string(),
                    raw_key: trimmed.to_string(),
                    source: source.to_string(),
                });
            }
        }
    }

    // 2. 내부 암호화 DB 보관함 스캔
    if let Ok(conn) = state.db.lock() {
        for cli_id in ["claude", "codex", "antigravity", "grok"] {
            if let Ok(env_map) = db::get_decrypted_env_for_cli(&conn, cli_id) {
                for (k, v) in env_map {
                    if !v.trim().is_empty() {
                        let provider = match cli_id {
                            "claude" => "anthropic",
                            "codex" => "openai",
                            "antigravity" => "gemini",
                            "grok" => "groq",
                            _ => "openai",
                        };
                        results.push(DetectedCliCredential {
                            cli_id: cli_id.to_string(),
                            provider: provider.to_string(),
                            key_name: k,
                            raw_key: v,
                            source: "Agentrix API 키 보관함".to_string(),
                        });
                    }
                }
            }
        }
    }

    // 3. 로컬 CLI 설정 파일 스캔 (~/.claude.json 등)
    let home = cli::home_dir();
    let claude_json = home.join(".claude.json");
    if claude_json.exists() {
        if let Ok(text) = std::fs::read_to_string(&claude_json) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(api_key) = val.get("apiKey").and_then(|v| v.as_str()) {
                    results.push(DetectedCliCredential {
                        cli_id: "claude".into(),
                        provider: "anthropic".into(),
                        key_name: "ANTHROPIC_API_KEY".into(),
                        raw_key: api_key.to_string(),
                        source: "~/.claude.json 파일".into(),
                    });
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
async fn run_cli_deep_analysis(
    state: State<'_, AppState>,
    cli_id: String,
    project_path: String,
    prompt: String,
) -> Result<String, String> {
    let (binary_path, env_map) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let clis = cli::detect_all_clis_with_db(&conn);
        let cli_def = clis.into_iter().find(|c| c.id == cli_id)
            .ok_or_else(|| format!("CLI를 찾을 수 없습니다: {}", cli_id))?;
        let bin = cli_def.resolved_binary
            .ok_or_else(|| format!("{} 바이너리가 설치되어 있지 않습니다.", cli_def.name))?;
        let envs = db::get_decrypted_env_for_cli(&conn, &cli_id).unwrap_or_default();
        (bin, envs)
    };

    let norm_path = db::normalize_project_path(&project_path);

    // Windows에서 배치 파일(.cmd, .bat) 우회 및 실제 네이티브 .exe 우선 탐색
    let mut effective_binary = binary_path;
    #[cfg(target_os = "windows")]
    {
        let lower = effective_binary.to_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            if cli_id == "claude" {
                if let Ok(appdata) = std::env::var("APPDATA") {
                    let direct_exe = std::path::PathBuf::from(appdata)
                        .join(r"npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe");
                    if direct_exe.exists() {
                        effective_binary = direct_exe.to_string_lossy().to_string();
                    }
                }
            } else if cli_id == "antigravity" {
                if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
                    let direct_exe = std::path::PathBuf::from(local_appdata).join(r"agy\bin\agy.exe");
                    if direct_exe.exists() {
                        effective_binary = direct_exe.to_string_lossy().to_string();
                    }
                }
            }
        }
    }

    let is_batch = effective_binary.to_lowercase().ends_with(".cmd") || effective_binary.to_lowercase().ends_with(".bat");

    let mut cmd = if is_batch {
        let mut c = std::process::Command::new("cmd.exe");
        c.arg("/D").arg("/C").arg(&effective_binary);
        c
    } else {
        std::process::Command::new(&effective_binary)
    };

    cmd.current_dir(&norm_path);

    for (k, v) in env_map {
        cmd.env(k, v);
    }

    if cli_id == "claude" {
        cmd.arg("-p").arg(&prompt);
    } else if cli_id == "antigravity" {
        cmd.arg("-p").arg(&prompt);
    } else {
        cmd.arg(&prompt);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = tauri::async_runtime::spawn_blocking(move || {
        cmd.output().map_err(|e| format!("CLI 실행 실패: {}", e))
    }).await.map_err(|e| e.to_string())??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let err_msg = if !stderr.trim().is_empty() { stderr.to_string() } else { stdout.to_string() };
        return Err(format!("CLI 오류 (코드 {:?}): {}", output.status.code(), err_msg));
    }

    let result_text = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(result_text)
}

#[tauri::command]
async fn check_token_tools() -> Result<Vec<tools::ToolStatus>, String> {
    tokio::task::spawn_blocking(tools::check).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn install_token_tool(tool_id: String) -> Result<tools::InstallResult, String> {
    tokio::task::spawn_blocking(move || tools::install(&tool_id)).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn trust_project_folder(project_path: String) -> Result<(), String> {
    pty::auto_trust_project_folder(&project_path);
    Ok(())
}

/// 세션의 실제 컨텍스트 토큰 (CLI 로그 기반). 로그가 없는 CLI는 None → 프론트가 화면 추정치 사용
#[tauri::command]
async fn get_session_context(
    cli_id: String,
    session_id: String,
    cwd: String,
    started_at: String,
    claimed: Vec<String>,
) -> Result<Option<context::ContextUsage>, String> {
    tokio::task::spawn_blocking(move || context::read_context(&cli_id, &session_id, &cwd, &started_at, &claimed))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_session(
    state: State<'_, AppState>,
    app: AppHandle,
    cli_id: String,
    cwd: Option<String>,
    initial_command: Option<String>,
    agent_id: Option<String>,
    model: Option<String>,
    permission_args: Option<Vec<String>>,
    permission_auto: Option<bool>,
    suppress_brief: Option<bool>,
) -> Result<SessionInfo, String> {
    let (mut cli_def, mut injected_env, mut agent_meta, headroom_enabled) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(ref dir) = cwd {
            if !dir.trim().is_empty() {
                let _ = db::upsert_project_folder(&conn, dir);
            }
        }
        let def = cli::detect_all_clis_with_db(&conn)
            .into_iter()
            .find(|c| c.id == cli_id)
            .ok_or_else(|| format!("지원하지 않는 CLI ID입니다: {}", cli_id))?;
        let env = db::get_decrypted_env_for_cli(&conn, &cli_id).unwrap_or_default();

        let found_agent = if let (Some(ref aid), Some(ref dir)) = (&agent_id, &cwd) {
            db::get_project_agents(&conn, dir)
                .unwrap_or_default()
                .into_iter()
                .find(|a| &a.id == aid)
        } else {
            None
        };

        let headroom_enabled = db::get_registry_items(&conn)
            .map_err(|e| e.to_string())?
            .iter()
            .any(|item| item.id == "headroom-mcp" && item.enabled);
        (def, env, found_agent, headroom_enabled)
    };
    if suppress_brief.unwrap_or(false) {
        if let Some(agent) = agent_meta.as_mut() { agent.auto_brief = false; }
    }

    // 실행 모델: 명시값 > 에이전트 저장값 > CLI 기본 (모든 지원 CLI가 --model 플래그 사용)
    let model = model
        .filter(|m| !m.trim().is_empty())
        .or_else(|| agent_meta.as_ref().map(|a| a.model.clone()).filter(|m| !m.trim().is_empty()));
    if let Some(m) = model {
        cli_def.args.extend(["--model".to_string(), m.trim().to_string()]);
    }
    cli_def.args.extend(permission_args.unwrap_or_default());
    if cli_id == "opencode" && permission_auto.unwrap_or(false) {
        injected_env.insert("OPENCODE_PERMISSION".into(), r#"{"*":"allow"}"#.into());
    }

    state.pty.start_session_with_def(
        cli_def,
        cwd,
        injected_env,
        headroom_command(initial_command, headroom_enabled),
        agent_meta,
        Some(app),
    )
}

fn headroom_command(command: Option<String>, enabled: bool) -> Option<String> {
    command.filter(|value| enabled || value != "__WRAPPER__")
}

#[cfg(test)]
mod headroom_launch_tests {
    use super::headroom_command;

    #[test]
    fn disabled_headroom_blocks_wrapper_only() {
        assert_eq!(headroom_command(Some("__WRAPPER__".into()), false), None);
        assert_eq!(headroom_command(Some("__WRAPPER__".into()), true).as_deref(), Some("__WRAPPER__"));
        assert_eq!(headroom_command(Some("echo ok".into()), false).as_deref(), Some("echo ok"));
        assert_eq!(headroom_command(None, false), None);
    }
}

/// CLI별 선택 가능한 모델 목록 (모델 호출 없이 각 CLI가 제공하는 목록을 읽음)
#[tauri::command]
async fn list_cli_models(cli_id: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || usage::list_cli_models(&cli_id))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn write_to_session(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let cli_id = state.pty.write_to_session(&session_id, data.as_bytes())?;
    if data.contains('\r') || data.contains('\n') {
        if let Ok(conn) = state.db.lock() {
            usage::record_live_session_interaction(&conn, &cli_id, data.len());
        }
    }
    Ok(())
}

#[tauri::command]
fn resize_session(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.pty.resize_session(&session_id, cols, rows)
}

#[tauri::command]
fn read_session_output(
    state: State<'_, AppState>,
    session_id: String,
    cursor: usize,
) -> Result<PtyOutputChunk, String> {
    state.pty.read_output_from(&session_id, cursor)
}

#[tauri::command]
fn stop_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.pty.stop_session(&session_id)
}

#[tauri::command]
fn list_sessions(state: State<'_, AppState>) -> Vec<SessionInfo> {
    state.pty.list_sessions()
}

#[tauri::command]
fn get_api_keys(state: State<'_, AppState>) -> Result<Vec<ApiKeyStatus>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_api_keys_status(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_api_key(
    state: State<'_, AppState>,
    cli_id: String,
    key_name: String,
    raw_key: String,
) -> Result<ApiKeyStatus, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::save_api_key(&conn, &cli_id, &key_name, &raw_key).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_api_key(
    state: State<'_, AppState>,
    cli_id: String,
    key_name: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_api_key(&conn, &cli_id, &key_name).map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_usage_logs(
    state: State<'_, AppState>,
    cli_filter: Option<String>,
    timeframe: Option<String>,
) -> Result<UsageDashboardData, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        usage::prefetch_live_quotas();
        let _ = usage::sync_all_cli_logs_shared(&db);
        let conn = db.lock().map_err(|e| e.to_string())?;
        db::get_usage_dashboard(&conn, cli_filter.as_deref(), timeframe.as_deref()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_usage_dashboard(
    state: State<'_, AppState>,
    cli_filter: Option<String>,
    timeframe: Option<String>,
) -> Result<UsageDashboardData, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        usage::prefetch_live_quotas();
        let conn = db.lock().map_err(|e| e.to_string())?;
        db::get_usage_dashboard(&conn, cli_filter.as_deref(), timeframe.as_deref()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_registry_items(state: State<'_, AppState>) -> Result<Vec<RegistryItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_registry_items(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn scan_local_extensions(state: State<'_, AppState>) -> Result<Vec<RegistryItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let _ = mcp::discover_local_cli_extensions(&conn);
    db::get_registry_items(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_registry_item(
    state: State<'_, AppState>,
    item_id: String,
    enabled: bool,
) -> Result<RegistryItem, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::toggle_registry_item(&conn, &item_id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
fn upsert_registry_item(
    state: State<'_, AppState>,
    id: String,
    kind: String,
    name: String,
    description: String,
    config_json: String,
    applied_clis: Vec<String>,
) -> Result<RegistryItem, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_registry_item(&conn, &id, &kind, &name, &description, &config_json, &applied_clis)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn apply_item_to_cli(
    state: State<'_, AppState>,
    item_id: String,
    cli_id: String,
) -> Result<ApplyResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    mcp::apply_item_to_cli(&conn, &item_id, &cli_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config_backups(state: State<'_, AppState>) -> Result<Vec<BackupRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_backups(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_team_members(state: State<'_, AppState>) -> Result<Vec<TeamMemberRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_team_members(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_team_member(
    state: State<'_, AppState>,
    name: String,
    role: String,
    department: String,
    favorite_cli: String,
) -> Result<Vec<TeamMemberRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_team_member(&conn, &name, &role, &department, &favorite_cli).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_team_member(
    state: State<'_, AppState>,
    member_id: String,
) -> Result<Vec<TeamMemberRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_team_member(&conn, &member_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_window_start_dragging(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_window_toggle_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn app_window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_window_hide(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_window_show(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_window_exit(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

#[tauri::command]
fn app_window_is_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_notes: String,
    pub release_url: String,
    pub download_url: Option<String>,
    pub published_at: String,
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse_semver = |s: &str| -> Vec<u64> {
        s.split('.')
            .filter_map(|p| p.split('-').next().and_then(|x| x.parse::<u64>().ok()))
            .collect()
    };
    let l_parts = parse_semver(latest);
    let c_parts = parse_semver(current);
    l_parts > c_parts
}

#[tauri::command]
fn check_app_update() -> Result<AppUpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let url = "https://api.github.com/repos/TodookGamja/AgentriX/releases/latest";
    let resp = match ureq::get(url)
        .set("User-Agent", &format!("AgentriX-Updater/{}", current_version))
        .timeout(std::time::Duration::from_secs(5))
        .call()
    {
        Ok(r) => r,
        Err(_e) => {
            return Ok(AppUpdateInfo {
                current_version: format!("v{}", current_version),
                latest_version: format!("v{}", current_version),
                has_update: false,
                release_notes: String::new(),
                release_url: "https://github.com/TodookGamja/AgentriX/releases".to_string(),
                download_url: None,
                published_at: String::new(),
            });
        }
    };

    let json: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    let tag = json.get("tag_name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let release_notes = json.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let release_url = json.get("html_url").and_then(|v| v.as_str()).unwrap_or("https://github.com/TodookGamja/AgentriX/releases").to_string();
    let published_at = json.get("published_at").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let mut download_url = None;
    if let Some(assets) = json.get("assets").and_then(|v| v.as_array()) {
        // 1순위: 즉시 인플레이스 교체 가능한 단일 실행 바이너리 AgentriX.exe
        for asset in assets {
            if let Some(name) = asset.get("name").and_then(|v| v.as_str()) {
                if name.eq_ignore_ascii_case("AgentriX.exe") {
                    if let Some(durl) = asset.get("browser_download_url").and_then(|v| v.as_str()) {
                        download_url = Some(durl.to_string());
                        break;
                    }
                }
            }
        }
        // 2순위: 기타 실행 파일
        if download_url.is_none() {
            for asset in assets {
                if let Some(name) = asset.get("name").and_then(|v| v.as_str()) {
                    if name.ends_with(".exe") {
                        if let Some(durl) = asset.get("browser_download_url").and_then(|v| v.as_str()) {
                            download_url = Some(durl.to_string());
                            break;
                        }
                    }
                }
            }
        }
    }

    let clean_tag = tag.trim_start_matches('v');
    let has_update = !clean_tag.is_empty() && clean_tag != current_version && is_newer_version(clean_tag, &current_version);

    Ok(AppUpdateInfo {
        current_version: format!("v{}", current_version),
        latest_version: if tag.is_empty() { format!("v{}", current_version) } else { tag },
        has_update,
        release_notes,
        release_url,
        download_url,
        published_at,
    })
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("rundll32");
        cmd.args(["url.dll,FileProtocolHandler", &url]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn download_and_save_update(url: String, filename: Option<String>) -> Result<String, String> {
    let download_dir = dirs::download_dir().unwrap_or_else(|| {
        dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")).join("Downloads")
    });
    let _ = std::fs::create_dir_all(&download_dir);

    let fname = filename.unwrap_or_else(|| {
        url.split('/').last().unwrap_or("AgentriX_update.exe").to_string()
    });
    let target_path = download_dir.join(&fname);

    let resp = ureq::get(&url)
        .set("User-Agent", "AgentriX-Updater")
        .call()
        .map_err(|e| format!("다운로드 요청 실패: {}", e))?;

    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&target_path)
        .map_err(|e| format!("파일 생성 실패: {}", e))?;
    std::io::copy(&mut reader, &mut file)
        .map_err(|e| format!("파일 저장 실패: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(format!("/select,{}", target_path.to_string_lossy()));
        cmd.creation_flags(0x08000000);
        let _ = cmd.spawn();
    }

    Ok(target_path.to_string_lossy().to_string())
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct UpdateProgressPayload {
    pub status: String, // "downloading" | "installing" | "done" | "error"
    pub percent: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub message: String,
}

#[tauri::command]
async fn perform_in_app_update(app: tauri::AppHandle, download_url: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        do_perform_in_app_update(app, download_url)
    })
    .await
    .map_err(|e| format!("업데이트 태스크 실행 오류: {}", e))?
}

fn do_perform_in_app_update(app: tauri::AppHandle, download_url: String) -> Result<(), String> {
    use std::io::{Read, Write};

    let _ = app.emit("update-progress", UpdateProgressPayload {
        status: "downloading".to_string(),
        percent: 0.0,
        downloaded_bytes: 0,
        total_bytes: 0,
        message: "업데이트 서버에 연결하는 중...".to_string(),
    });

    let resp = ureq::get(&download_url)
        .set("User-Agent", "AgentriX-SelfUpdater")
        .call()
        .map_err(|e| {
            let msg = format!("업데이트 다운로드 요청 실패: {}", e);
            let _ = app.emit("update-progress", UpdateProgressPayload {
                status: "error".to_string(),
                percent: 0.0,
                downloaded_bytes: 0,
                total_bytes: 0,
                message: msg.clone(),
            });
            msg
        })?;

    let total_bytes: u64 = resp.header("Content-Length").and_then(|s| s.parse().ok()).unwrap_or(0);
    let temp_dir = std::env::temp_dir();
    let temp_exe = temp_dir.join(format!("agentrix_update_{}.exe", std::process::id()));

    if temp_exe.exists() {
        let _ = std::fs::remove_file(&temp_exe);
    }

    let mut file = std::fs::File::create(&temp_exe)
        .map_err(|e| format!("임시 파일 생성 실패: {}", e))?;

    let mut reader = resp.into_reader();
    let mut buffer = [0u8; 65536];
    let mut downloaded_bytes: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    loop {
        let n = reader.read(&mut buffer).map_err(|e| format!("데이터 수신 오류: {}", e))?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n]).map_err(|e| format!("파일 기록 오류: {}", e))?;
        downloaded_bytes += n as u64;

        if last_emit.elapsed().as_millis() >= 80 || (total_bytes > 0 && downloaded_bytes == total_bytes) {
            let percent = if total_bytes > 0 {
                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).min(100.0)
            } else {
                0.0
            };
            let _ = app.emit("update-progress", UpdateProgressPayload {
                status: "downloading".to_string(),
                percent,
                downloaded_bytes,
                total_bytes,
                message: format!(
                    "{:.1} MB / {:.1} MB ({:.0}%)",
                    downloaded_bytes as f64 / 1_048_576.0,
                    total_bytes as f64 / 1_048_576.0,
                    percent
                ),
            });
            last_emit = std::time::Instant::now();
        }
    }
    drop(file);

    // 유효성 검증: 크기 및 PE 헤더 확인
    let meta = std::fs::metadata(&temp_exe).map_err(|e| e.to_string())?;
    if meta.len() < 3 * 1024 * 1024 {
        let _ = std::fs::remove_file(&temp_exe);
        let err_msg = "다운로드된 파일 크기가 비정상적입니다 (3MB 미만).".to_string();
        let _ = app.emit("update-progress", UpdateProgressPayload {
            status: "error".to_string(),
            percent: 0.0,
            downloaded_bytes,
            total_bytes,
            message: err_msg.clone(),
        });
        return Err(err_msg);
    }

    let mut verify_file = std::fs::File::open(&temp_exe).map_err(|e| e.to_string())?;
    let mut magic = [0u8; 2];
    if verify_file.read_exact(&mut magic).is_err() || &magic != b"MZ" {
        drop(verify_file);
        let _ = std::fs::remove_file(&temp_exe);
        let err_msg = "다운로드된 파일이 유효한 Windows 실행 파일이 아닙니다.".to_string();
        let _ = app.emit("update-progress", UpdateProgressPayload {
            status: "error".to_string(),
            percent: 0.0,
            downloaded_bytes,
            total_bytes,
            message: err_msg.clone(),
        });
        return Err(err_msg);
    }
    drop(verify_file);

    let _ = app.emit("update-progress", UpdateProgressPayload {
        status: "installing".to_string(),
        percent: 100.0,
        downloaded_bytes,
        total_bytes,
        message: "새 버전 적용 및 앱 자동 재실행 중...".to_string(),
    });

    std::thread::sleep(std::time::Duration::from_millis(300));

    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let backup_exe = current_exe.with_extension("exe.old");

    // 이전 잔류 .old 백업 파일 정리
    if backup_exe.exists() {
        let _ = std::fs::remove_file(&backup_exe);
    }

    // 1차 시도: Atomic rename & copy
    let rename_ok = std::fs::rename(&current_exe, &backup_exe).is_ok();
    if rename_ok {
        if let Err(e) = std::fs::copy(&temp_exe, &current_exe) {
            let _ = std::fs::rename(&backup_exe, &current_exe);
            let _ = std::fs::remove_file(&temp_exe);
            let err_msg = format!("실행 파일 교체 실패: {}", e);
            let _ = app.emit("update-progress", UpdateProgressPayload {
                status: "error".to_string(),
                percent: 0.0,
                downloaded_bytes,
                total_bytes,
                message: err_msg.clone(),
            });
            return Err(err_msg);
        }
        let _ = std::fs::remove_file(&temp_exe);

        // 새 버전 프로세스 독립 실행
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let mut cmd = std::process::Command::new(&current_exe);
            cmd.creation_flags(0x00000200 | 0x00000008);
            let _ = cmd.spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new(&current_exe).spawn();
        }

        std::process::exit(0);
    } else {
        // 2차 시도: Fallback 배치 스크립트 (현재 PID 종료 대기 후 복사 및 재실행)
        let script_path = temp_dir.join(format!("agentrix_swap_{}.bat", std::process::id()));
        let script_content = format!(
            "@echo off\r\n\
             chcp 65001 >nul\r\n\
             :wait_loop\r\n\
             tasklist /fi \"pid eq {pid}\" 2>nul | find \"{pid}\" >nul\r\n\
             if not errorlevel 1 (\r\n\
                 timeout /t 1 /nobreak >nul\r\n\
                 goto wait_loop\r\n\
             )\r\n\
             timeout /t 1 /nobreak >nul\r\n\
             copy /y \"{new_exe}\" \"{target_exe}\" >nul\r\n\
             del /f /q \"{new_exe}\" 2>nul\r\n\
             start \"\" \"{target_exe}\"\r\n\
             del /f /q \"%~f0\" 2>nul\r\n",
            pid = std::process::id(),
            new_exe = temp_exe.to_string_lossy(),
            target_exe = current_exe.to_string_lossy()
        );
        let _ = std::fs::write(&script_path, script_content);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let mut cmd = std::process::Command::new("cmd.exe");
            cmd.args(["/c", &script_path.to_string_lossy()]);
            cmd.creation_flags(0x08000000 | 0x00000008);
            let _ = cmd.spawn();
        }

        std::process::exit(0);
    }
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            format!("{:?}", info)
        };
        let msg = format!("PANIC: {}\nLocation: {:?}\n", payload, info.location());
        let _ = std::fs::write("panic.log", msg);
    }));
    // 이전 자동 업데이트 후 잔여 백업 파일(.exe.old) 자동 청소
    if let Ok(exe) = std::env::current_exe() {
        let old_exe = exe.with_extension("exe.old");
        if old_exe.exists() {
            let _ = std::fs::remove_file(old_exe);
        }
    }

    let conn = init_db().expect("SQLite 데이터베이스 초기화 실패");
    let db_arc = Arc::new(Mutex::new(conn));
    let db_clone = Arc::clone(&db_arc);

    // 백그라운드 비동기 동기화:
    // 초기 UI 로딩과 첫 쿼터 조회가 0ms 지연 없이 완료된 후 백그라운드 스캔 실행
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        let _ = usage::sync_all_cli_logs_shared(&db_clone);
        if let Ok(c) = db_clone.lock() {
            let _ = mcp::discover_local_cli_extensions(&c);
        }
    });

    let app_state = AppState {
        pty: PtyManager::default(),
        db: db_arc,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .manage(app_state)
        .setup(|app| {
            let win = match app.get_webview_window("main") {
                Some(w) => w,
                None => {
                    tauri::WebviewWindowBuilder::new(
                        app,
                        "main",
                        tauri::WebviewUrl::App("index.html".into()),
                    )
                    .title("AgentriX — AI Agent Workspace & Token Hub")
                    .inner_size(1440.0, 920.0)
                    .min_inner_size(1024.0, 680.0)
                    .resizable(true)
                    .decorations(false)
                    .shadow(true)
                    .center()
                    .visible(true)
                    .build()?
                }
            };
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();

            // 작업표시줄(Taskbar) 및 윈도우 메인 아이콘 명시적 설정
            let app_icon = tauri::include_image!("icons/icon.png");
            let _ = win.set_icon(app_icon.clone());

            // =========================================================
            // 시스템 트레이(System Tray) 아이콘 및 컨텍스트 메뉴 구성
            // =========================================================
            let show_item = MenuItem::with_id(app, "show", "AgentriX 열기", true, None::<&str>)?;
            let refresh_item = MenuItem::with_id(app, "refresh", "한도 현황 새로고침", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "완전 종료", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &refresh_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("AgentriX — AI Agent Workspace & Token Hub")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "refresh" => {
                        let _ = crate::usage::extract_claude_quota(true);
                        let _ = crate::usage::extract_antigravity_quota(true);
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.emit("tray-quota-refreshed", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let is_visible = w.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = w.set_focus();
                            } else {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    }
                });

            let tray_icon = tauri::include_image!("icons/32x32.png");
            tray_builder = tray_builder.icon(tray_icon);

            let _ = tray_builder.build(app);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_session_context,
            detect_clis,
            add_custom_cli,
            delete_custom_cli,
            set_app_theme_mode,
            get_project_folders,
            add_project_folder,
            delete_project_folder,
            pick_project_folder,
            list_directory_entries,
            get_project_agents,
            list_cli_models,
            upsert_project_agent,
            delete_project_agent,
            seed_project_agents_preset,
            get_project_blackboard,
            route_team_mail,
            acknowledge_team_mail,
            save_project_blackboard,
            save_session_handoff,
            trust_project_folder,
            analyze_project_workspace,
            get_project_deep_context,
            check_npm_cli_updates,
            check_plugin_updates,
            update_plugin,
            check_token_tools,
            install_token_tool,
            install_npm_cli_update,
            get_detected_cli_credentials,
            run_cli_deep_analysis,
            start_session,
            write_to_session,
            resize_session,
            read_session_output,
            stop_session,
            list_sessions,
            get_api_keys,
            save_api_key,
            delete_api_key,
            sync_usage_logs,
            get_usage_dashboard,
            get_registry_items,
            scan_local_extensions,
            toggle_registry_item,
            upsert_registry_item,
            apply_item_to_cli,
            get_config_backups,
            get_team_members,
            add_team_member,
            delete_team_member,
            app_window_start_dragging,
            app_window_minimize,
            app_window_toggle_maximize,
            app_window_close,
            app_window_hide,
            app_window_show,
            app_window_exit,
            app_window_is_maximized,
            check_app_update,
            open_external_url,
            download_and_save_update,
            perform_in_app_update,
            reset_app_data,
            save_clipboard_image,
            read_file_as_base64,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 애플리케이션 실행 중 오류 발생");
}
