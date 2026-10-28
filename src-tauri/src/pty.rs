use crate::cli::CliDefinition;
use crate::db::ProjectAgentRecord;
use chrono::Utc;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub cli_id: String,
    pub name: String,
    pub binary_path: String,
    pub cwd: String,
    pub status: String,
    pub env_injected: Vec<String>,
    pub started_at: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub agent_role: Option<String>,
    pub agent_emoji: Option<String>,
    pub role_prompt: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputChunk {
    pub session_id: String,
    pub data: String,
    pub next_cursor: usize,
}

pub struct PtySession {
    pub info: SessionInfo,
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub output_buffer: Arc<Mutex<Vec<u8>>>,
}

#[derive(Default, Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

pub fn auto_trust_project_folder(project_path: &str) {
    if let Some(home) = dirs::home_dir() {
        let claude_json_path = home.join(".claude.json");
        if claude_json_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&claude_json_path) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(projects) = json.get_mut("projects").and_then(|p| p.as_object_mut()) {
                        let win_path = project_path.replace('/', "\\");
                        let unix_path = project_path.replace('\\', "/");

                        let trust_entry = serde_json::json!({
                            "hasTrustDialogAccepted": true,
                            "allowedTools": []
                        });

                        projects
                            .entry(&win_path)
                            .or_insert_with(|| trust_entry.clone())
                            .as_object_mut()
                            .map(|o| o.insert("hasTrustDialogAccepted".to_string(), serde_json::json!(true)));

                        projects
                            .entry(&unix_path)
                            .or_insert_with(|| trust_entry)
                            .as_object_mut()
                            .map(|o| o.insert("hasTrustDialogAccepted".to_string(), serde_json::json!(true)));

                        if let Ok(updated) = serde_json::to_string_pretty(&json) {
                            let _ = std::fs::write(&claude_json_path, updated);
                        }
                    }
                }
            }
        }
    }
}

pub fn resolve_safe_cwd(cwd: Option<String>) -> String {
    if let Some(raw) = cwd {
        let trimmed = raw.trim().replace('/', "\\");
        if !trimmed.is_empty()
            && !crate::db::is_forbidden_system_dir(&trimmed)
            && Path::new(&trimmed).is_dir()
        {
            return trimmed;
        }
    }

    if let Ok(cur) = std::env::current_dir() {
        let cur_str = cur.to_string_lossy().to_string();
        if !crate::db::is_forbidden_system_dir(&cur_str) && cur.is_dir() {
            return cur_str;
        }
    }

    crate::db::default_safe_project_dir()
}

impl PtyManager {
    pub fn start_session_with_def(
        &self,
        cli_def: CliDefinition,
        cwd: Option<String>,
        injected_env: HashMap<String, String>,
        initial_command: Option<String>,
        agent_meta: Option<ProjectAgentRecord>,
        app_handle: Option<AppHandle>,
    ) -> Result<SessionInfo, String> {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 30,
            cols: 110,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

        let safe_cwd = resolve_safe_cwd(cwd);

        // 프로젝트 폴더 신뢰 자동 등록 (폴더 신뢰 질문 원천 스킵)
        auto_trust_project_folder(&safe_cwd);

        // Claude 또는 Headroom 래퍼(hclaude) 실행 시 프로젝트 폴더 내 .claude 디렉터리 미리 보장
        if cli_def.id == "claude" || initial_command.as_deref() == Some("__WRAPPER__") {
            let _ = std::fs::create_dir_all(Path::new(&safe_cwd).join(".claude"));
        }

        if let Some(ref agent) = agent_meta {
            crate::db::sync_agent_files_on_disk(agent);
        }

        let (mut cmd, binary_label) = build_platform_command(
            &cli_def,
            initial_command.as_deref(),
            &safe_cwd,
            agent_meta.as_ref(),
        );

        cmd.cwd(&safe_cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        if let Some(ref agent) = agent_meta {
            cmd.env("AI_AGENT_ID", &agent.id);
            cmd.env("AI_AGENT_NAME", &agent.name);
            cmd.env("AI_AGENT_ROLE", &agent.role_title);
            cmd.env(
                "AI_PROJECT_BLACKBOARD",
                Path::new(&safe_cwd)
                    .join(".ai-agents")
                    .join("BLACKBOARD.md")
                    .to_string_lossy()
                    .to_string(),
            );
            cmd.env(
                "AI_AGENT_ROLE_FILE",
                Path::new(&safe_cwd)
                    .join(".ai-agents")
                    .join("agents")
                    .join(&agent.id)
                    .join("ROLE.md")
                    .to_string_lossy()
                    .to_string(),
            );
        }

        let mut env_injected_keys = Vec::new();
        for (k, v) in &injected_env {
            if !v.trim().is_empty() {
                cmd.env(k, v);
                env_injected_keys.push(k.clone());
            }
        }
        env_injected_keys.sort();

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let session_id = Uuid::new_v4().to_string();
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let output_buffer = Arc::new(Mutex::new(Vec::new()));

        let buffer_clone = output_buffer.clone();
        let sid_clone = session_id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk_bytes = &buf[..n];
                        {
                            let mut locked = buffer_clone.lock().unwrap();
                            locked.extend_from_slice(chunk_bytes);
                            if locked.len() > 524_288 {
                                let drain_len = locked.len() - 393_216;
                                locked.drain(..drain_len);
                            }
                        }
                        if let Some(ref app) = app_handle {
                            let text = String::from_utf8_lossy(chunk_bytes).to_string();
                            let _ = app.emit(
                                "pty-data",
                                serde_json::json!({
                                    "sessionId": sid_clone,
                                    "data": text,
                                }),
                            );
                        }
                    }
                }
            }
        });

        let display_name = if let Some(ref agent) = agent_meta {
            format!("{} {}", agent.avatar_emoji, agent.name)
        } else {
            cli_def.name.clone()
        };

        let info = SessionInfo {
            id: session_id.clone(),
            cli_id: cli_def.id.clone(),
            name: display_name,
            binary_path: binary_label,
            cwd: safe_cwd,
            status: "running".into(),
            env_injected: env_injected_keys,
            started_at: Utc::now().to_rfc3339(),
            agent_id: agent_meta.as_ref().map(|a| a.id.clone()),
            agent_name: agent_meta.as_ref().map(|a| a.name.clone()),
            agent_role: agent_meta.as_ref().map(|a| a.role_title.clone()),
            agent_emoji: agent_meta.as_ref().map(|a| a.avatar_emoji.clone()),
            role_prompt: agent_meta.as_ref().map(|a| a.role_prompt.clone()),
        };

        let session = PtySession {
            info: info.clone(),
            master: pair.master,
            writer,
            child,
            output_buffer,
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), session);

        Ok(info)
    }

    pub fn start_session(
        &self,
        cli_id: String,
        cwd: Option<String>,
        injected_env: HashMap<String, String>,
        initial_command: Option<String>,
        app_handle: Option<AppHandle>,
    ) -> Result<SessionInfo, String> {
        let detected = crate::cli::detect_clis();
        let cli_def = detected
            .into_iter()
            .find(|c| c.id == cli_id)
            .ok_or_else(|| format!("지원하지 않는 CLI ID입니다: {}", cli_id))?;
        self.start_session_with_def(cli_def, cwd, injected_env, initial_command, None, app_handle)
    }

    pub fn write_to_session(&self, session_id: &str, data: &[u8]) -> Result<String, String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| "세션을 찾을 수 없습니다.".to_string())?;

        let mut bytes = data.to_vec();
        // ConPTY 표준 키 입력 처리:
        // 터미널 입력에서 엔터(Enter)는 항상 단일 CR(0x0D, '\r')이어야 합니다.
        // \r\n이 전달되면 ConPTY/PSReadLine에서 엔터 후 줄바꿈(Shift+Enter)으로 오인하여
        // 멀티라인 입력 대기 상태(쉘 멈춤/먹통 현상)가 발생하므로 \r\n을 \r로 정규화합니다.
        if bytes.ends_with(b"\r\n") {
            bytes.pop(); // \n 제거하여 단일 \r만 전송
        } else if bytes.ends_with(b"\n") && (bytes.len() < 2 || bytes[bytes.len() - 2] != b'\r') {
            let last_idx = bytes.len() - 1;
            bytes[last_idx] = b'\r';
        }

        session
            .writer
            .write_all(&bytes)
            .map_err(|e| format!("세션 쓰기 오류: {}", e))?;
        let _ = session.writer.flush();
        Ok(session.info.cli_id.clone())
    }

    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| "세션을 찾을 수 없습니다.".to_string())?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(5),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn read_output_from(&self, session_id: &str, cursor: usize) -> Result<PtyOutputChunk, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "세션을 찾을 수 없습니다.".to_string())?;
        let buffer = session.output_buffer.lock().unwrap();
        let safe_cursor = cursor.min(buffer.len());
        let data = String::from_utf8_lossy(&buffer[safe_cursor..]).to_string();
        let next_cursor = buffer.len();
        Ok(PtyOutputChunk {
            session_id: session_id.to_string(),
            data,
            next_cursor,
        })
    }

    pub fn stop_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(mut session) = sessions.remove(session_id) {
            #[cfg(target_os = "windows")]
            let pid_opt = session.child.process_id();

            // PTY child 즉각 종료
            let _ = session.child.kill();

            #[cfg(target_os = "windows")]
            if let Some(pid) = pid_opt {
                // Windows 환경에서 cmd/powershell 자식 프로세스 트리를 비동기 백그라운드 스레드에서 정리
                // 1) CREATE_NO_WINDOW (0x08000000) 플래그로 검은색 콘솔창 깜빡임 팝업 원천 차단
                // 2) 비동기 처리로 세션 닫을 때 메인 UI 스레드 렉(프리즈) 0% 달성
                std::thread::spawn(move || {
                    use std::os::windows::process::CommandExt;
                    let mut cmd = std::process::Command::new("taskkill");
                    cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
                    cmd.creation_flags(0x08000000);
                    let _ = cmd.output();
                });
            }
        }
        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        let sessions = self.sessions.lock().unwrap();
        let mut list: Vec<SessionInfo> = sessions.values().map(|s| s.info.clone()).collect();
        list.sort_by(|a, b| a.started_at.cmp(&b.started_at));
        list
    }
}

fn ps_escape_single_quoted(input: &str) -> String {
    input.replace('\'', "''")
}

fn build_platform_command(
    cli_def: &CliDefinition,
    initial_command: Option<&str>,
    safe_cwd: &str,
    agent_meta: Option<&ProjectAgentRecord>,
) -> (CommandBuilder, String) {
    let escaped_cwd = ps_escape_single_quoted(safe_cwd);
    let agent_banner = if let Some(agent) = agent_meta {
        let esc_name = ps_escape_single_quoted(&agent.name);
        let esc_role = ps_escape_single_quoted(&agent.role_title);
        let esc_id = ps_escape_single_quoted(&agent.id);
        format!(
            "Write-Host '[에이전트 출근] {} ({}) — 지침 파일: .ai-agents/agents/{}/ROLE.md' -ForegroundColor Magenta; ",
            esc_name, esc_role, esc_id
        )
    } else {
        String::new()
    };

    let auto_flags = if agent_meta.is_some() {
        match cli_def.id.as_str() {
            "antigravity" => " --dangerously-skip-permissions --mode auto",
            "claude" => " --dangerously-skip-permissions",
            "codex" => " --sandbox workspace-write --ask-for-approval never",
            "grok" => " --yolo",
            "opencode" => " --auto",
            _ => "",
        }
    } else {
        ""
    };

    if cli_def.id == "powershell" {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.args(["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass"]);
        return (cmd, "PowerShell".to_string());
    }

    if cli_def.id == "cmd" {
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.args(["/k"]);
        return (cmd, "명령 프롬프트 (CMD)".to_string());
    }

    if let Some(init_cmd) = initial_command.filter(|s| !s.trim().is_empty()) {
        if init_cmd == "__WRAPPER__" {
            let (exec_cmd, label) = if let Some(ref wrapper) = cli_def.wrapper_binary {
                (
                    format!("& '{}'", ps_escape_single_quoted(wrapper)),
                    format!("{} (Headroom Wrapper)", wrapper),
                )
            } else if let Some(ref resolved) = cli_def.resolved_binary {
                (
                    format!("headroom wrap '{}' --port 8788 --", ps_escape_single_quoted(resolved)),
                    format!("headroom wrap {}", cli_def.name),
                )
            } else {
                (
                    format!("headroom wrap {} --port 8788 --", cli_def.id),
                    format!("headroom wrap {}", cli_def.id),
                )
            };
            let extra_args = cli_def
                .args
                .iter()
                .map(|a| format!("'{}'", ps_escape_single_quoted(a)))
                .collect::<Vec<_>>()
                .join(" ");
            let ps_script = format!(
                "Set-Location -LiteralPath '{}'; {}Write-Host '[AI CLI Manager] 작업 폴더: {}' -ForegroundColor DarkCyan; {} {}{}",
                escaped_cwd, agent_banner, escaped_cwd, exec_cmd, extra_args, auto_flags
            );
            let mut cmd = CommandBuilder::new("powershell.exe");
            cmd.args([
                "-NoLogo",
                "-NoExit",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &ps_script,
            ]);
            return (cmd, label);
        } else {
            let ps_script = format!(
                "Set-Location -LiteralPath '{}'; {}Write-Host '[AI CLI Manager] 작업 폴더: {}' -ForegroundColor DarkCyan; {}{}",
                escaped_cwd, agent_banner, escaped_cwd, init_cmd, auto_flags
            );
            let mut cmd = CommandBuilder::new("powershell.exe");
            cmd.args([
                "-NoLogo",
                "-NoExit",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &ps_script,
            ]);
            return (cmd, format!("powershell ({})", init_cmd));
        }
    }

    if let Some(ref resolved) = cli_def.resolved_binary {
        let escaped_bin = ps_escape_single_quoted(resolved);
        let extra_args = cli_def
            .args
            .iter()
            .map(|a| format!("'{}'", ps_escape_single_quoted(a)))
            .collect::<Vec<_>>()
            .join(" ");
        let ps_script = format!(
            "Set-Location -LiteralPath '{}'; {}Write-Host '[AI CLI Manager] 작업 폴더: {}' -ForegroundColor DarkCyan; & '{}' {}{}",
            escaped_cwd, agent_banner, escaped_cwd, escaped_bin, extra_args, auto_flags
        );
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.args([
            "-NoLogo",
            "-NoExit",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &ps_script,
        ]);
        return (cmd, resolved.clone());
    }

    let mut cmd = CommandBuilder::new("powershell.exe");
    let banner = format!(
        "Set-Location -LiteralPath '{}'; {}Write-Host '[AI CLI Manager] 작업 폴더: {}' -ForegroundColor DarkCyan; Write-Host '[AI CLI Manager] {} 실행 파일을 PATH에서 찾지 못해 PowerShell 대체 세션으로 시작했습니다.' -ForegroundColor Yellow; Write-Host '로그인 또는 설치 명령: {}' -ForegroundColor Cyan",
        escaped_cwd, agent_banner, escaped_cwd, cli_def.name, cli_def.login_command
    );
    cmd.args(["-NoLogo", "-NoExit", "-Command", &banner]);
    (cmd, "powershell.exe (fallback)".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_safe_cwd_when_system32_passed_falls_back_to_safe_project_directory() {
        let safe = resolve_safe_cwd(Some("C:\\Windows\\System32".into()));
        assert!(!safe.to_lowercase().starts_with("c:\\windows"));
    }

    #[test]
    fn pty_manager_when_two_sessions_started_maintains_both_concurrently_until_stopped() {
        let mgr = PtyManager::default();
        let mut env = HashMap::new();
        env.insert("ANTHROPIC_API_KEY".into(), "sk-test-1234".into());

        let s1 = mgr
            .start_session(
                "claude".into(),
                None,
                env,
                Some("Write-Output 'SESSION_ONE_OK'".into()),
                None,
            )
            .expect("session 1 should start");

        let s2 = mgr
            .start_session(
                "codex".into(),
                None,
                HashMap::new(),
                Some("Write-Output 'SESSION_TWO_OK'".into()),
                None,
            )
            .expect("session 2 should start");

        assert_ne!(s1.id, s2.id);
        assert!(!s1.cwd.to_lowercase().starts_with("c:\\windows"));
        assert_eq!(s1.env_injected, vec!["ANTHROPIC_API_KEY".to_string()]);
        assert_eq!(mgr.list_sessions().len(), 2);

        mgr.resize_session(&s1.id, 120, 40).expect("resize should succeed");
        mgr.write_to_session(&s1.id, b"echo READY\r\n")
            .expect("write should succeed");

        mgr.stop_session(&s1.id).unwrap();
        let remaining = mgr.list_sessions();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, s2.id);

        mgr.stop_session(&s2.id).unwrap();
        assert!(mgr.list_sessions().is_empty());
    }
}
