#![windows_subsystem = "windows"]


pub mod cli;
pub mod db;
pub mod mcp;
pub mod pty;
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickAccessItem {
    pub name: String,
    pub path: String,
    pub kind: String, // "home", "desktop", "documents", "downloads", "drive", "project"
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

    let mut items = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&resolved_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            let is_dir = p.is_dir();
            if !is_dir {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            let is_hidden = file_name.starts_with('.') || file_name.starts_with('$');
            items.push(DirectoryItem {
                name: file_name,
                path: p.to_string_lossy().to_string(),
                is_dir: true,
                is_hidden,
            });
        }
    }
    items.sort_by(|a, b| {
        match (a.is_hidden, b.is_hidden) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
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
fn save_project_blackboard(project_path: String, content: String) -> Result<(), String> {
    db::save_project_blackboard(&project_path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_session_handoff(
    project_path: String,
    filename: Option<String>,
    content: String,
) -> Result<String, String> {
    let norm = db::normalize_project_path(&project_path);
    if norm.is_empty() || db::is_forbidden_system_dir(&norm) {
        return Err("유효하지 않은 프로젝트 경로입니다.".into());
    }
    let dir = std::path::Path::new(&norm).join(".ai-agents");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let fname = filename.unwrap_or_else(|| "SESSION_HANDOFF.md".to_string());
    let path = dir.join(&fname);
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn analyze_project_workspace(project_path: String) -> Result<ProjectAnalysisResult, String> {
    db::analyze_project_workspace(&project_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_project_deep_context(project_path: String) -> Result<db::ProjectDeepContext, String> {
    db::get_project_deep_context(&project_path).map_err(|e| e.to_string())
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
fn trust_project_folder(project_path: String) -> Result<(), String> {
    pty::auto_trust_project_folder(&project_path);
    Ok(())
}

#[tauri::command]
fn start_session(
    state: State<'_, AppState>,
    app: AppHandle,
    cli_id: String,
    cwd: Option<String>,
    initial_command: Option<String>,
    agent_id: Option<String>,
) -> Result<SessionInfo, String> {
    let (cli_def, injected_env, agent_meta) = {
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

        (def, env, found_agent)
    };

    state.pty.start_session_with_def(
        cli_def,
        cwd,
        injected_env,
        initial_command,
        agent_meta,
        Some(app),
    )
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
        let conn = db.lock().map_err(|e| e.to_string())?;
        let _ = usage::sync_all_cli_logs(&conn);
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
    let conn = init_db().expect("SQLite 데이터베이스 초기화 실패");
    let db_arc = Arc::new(Mutex::new(conn));
    let db_clone = Arc::clone(&db_arc);

    // 백그라운드 비동기 동기화:
    // 초기 UI 로딩과 첫 쿼터 조회가 0ms 지연 없이 완료된 후 백그라운드 스캔 실행
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        if let Ok(c) = db_clone.lock() {
            let _ = mcp::discover_local_cli_extensions(&c);
            let _ = usage::sync_all_cli_logs(&c);
        }
    });

    let app_state = AppState {
        pty: PtyManager::default(),
        db: db_arc,
    };

    tauri::Builder::default()
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
            upsert_project_agent,
            delete_project_agent,
            seed_project_agents_preset,
            get_project_blackboard,
            save_project_blackboard,
            save_session_handoff,
            trust_project_folder,
            analyze_project_workspace,
            get_project_deep_context,
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
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 애플리케이션 실행 중 오류 발생");
}
