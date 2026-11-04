fn main() {
    if let Ok(current_path) = std::env::var("PATH") {
        let sdk_bin = r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64";
        let msvc_bin = r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64";
        std::env::set_var("PATH", format!("{};{};{}", sdk_bin, msvc_bin, current_path));
    }

    #[cfg(target_os = "windows")]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("icons/icon.ico");
        res.set("ProductName", "AgentriX");
        res.set("FileDescription", "AgentriX — AI Agent Workspace & Token Hub");
        if let Err(e) = res.compile() {
            eprintln!("winres compile error: {}", e);
        }
    }

    // V104_SEC2: 앱 커맨드를 명시 목록으로 제한(목록 밖 커맨드는 호출 불가). 새 커맨드는 여기 + capabilities/*.json에 추가해야 한다.
    const APP_COMMANDS: &[&str] = &["session_user_message_submitted", "get_session_context", "get_session_quiet_since", "get_session_paste_mode", "detect_clis", "add_custom_cli", "delete_custom_cli", "set_app_theme_mode", "get_project_folders", "add_project_folder", "delete_project_folder", "pick_project_folder", "list_directory_entries", "get_project_agents", "get_cli_effort_options", "list_cli_models", "upsert_project_agent", "delete_project_agent", "seed_project_agents_preset", "get_project_blackboard", "route_team_mail", "acknowledge_team_mail", "save_project_blackboard", "cancel_project_blackboard_task", "save_session_handoff", "trust_project_folder", "analyze_project_workspace", "get_project_deep_context", "check_npm_cli_updates", "check_plugin_updates", "update_plugin", "check_token_tools", "install_token_tool", "install_npm_cli_update", "get_detected_cli_credentials", "request_with_detected_credential", "run_cli_deep_analysis", "start_session", "log_delivery_stage", "write_to_session", "resize_session", "read_session_output", "stop_session", "get_api_keys", "save_api_key", "delete_api_key", "sync_usage_logs", "get_usage_dashboard", "get_registry_items", "scan_local_extensions", "toggle_registry_item", "upsert_registry_item", "apply_item_to_cli", "get_config_backups", "get_team_members", "add_team_member", "delete_team_member", "app_window_start_dragging", "app_window_minimize", "app_window_toggle_maximize", "app_window_close", "app_window_hide", "app_window_show", "app_window_exit", "app_window_is_maximized", "check_app_update", "open_external_url", "perform_in_app_update", "reset_app_data", "save_clipboard_image", "read_file_as_base64"];
    let attrs = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS))
        .windows_attributes(tauri_build::WindowsAttributes::new().window_icon_path("icons/icon.ico"));
    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
