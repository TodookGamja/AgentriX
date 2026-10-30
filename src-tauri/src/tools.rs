//! 토큰 절감 도구(Headroom)와 그 실행 전제(uv) 설치 상태 감지 및 클릭 설치.
//! Caveman은 앱에 내장된 스킬이라 외부 설치가 필요 없어 여기서 다루지 않음.
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    /// 먼저 설치되어야 하는 도구 ID (설치 불가 시 UI에서 비활성화)
    pub requires: Option<String>,
    pub requires_met: bool,
    /// UI에 그대로 보여줄 실제 실행 명령 (사용자가 무엇이 실행되는지 알 수 있게)
    pub install_command: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub ok: bool,
    pub output: String,
}

const UV_INSTALL_WIN: &str = "irm https://astral.sh/uv/install.ps1 | iex";
const HEADROOM_SPEC: &str = "headroom-ai[proxy]";

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

/// 사용자 로컬 설치 위치(~/.local/bin, ~/.cargo/bin) 우선, 그다음 PATH
fn find_tool(name: &str) -> Option<PathBuf> {
    let home = crate::cli::home_dir();
    let file = exe(name);
    for dir in [home.join(".local").join("bin"), home.join(".cargo").join("bin")] {
        let p = dir.join(&file);
        if p.is_file() { return Some(p); }
    }
    let path = std::env::var("PATH").unwrap_or_default();
    crate::cli::resolve_cli_binary(name, &[file, name.to_string()], &path)
}

fn run(bin: &std::path::Path, args: &[&str]) -> (bool, String) {
    let mut cmd = std::process::Command::new(bin);
    cmd.args(args).stdin(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    match cmd.output() {
        Ok(o) => {
            let mut text = String::from_utf8_lossy(&o.stdout).to_string();
            text.push_str(&String::from_utf8_lossy(&o.stderr));
            (o.status.success(), text.trim().to_string())
        }
        Err(e) => (false, e.to_string()),
    }
}

fn version_of(name: &str) -> Option<String> {
    let bin = find_tool(name)?;
    let (ok, out) = run(&bin, &["--version"]);
    ok.then(|| out.lines().next().unwrap_or("").trim().to_string()).filter(|v| !v.is_empty())
}

/// uv tool list --show-extras 출력에서 headroom-ai의 proxy 옵션 설치 여부.
/// uv로 설치하지 않은 경우(pip 등)는 확인할 방법이 없어 None → 설치된 것으로 간주
fn headroom_proxy_extra() -> Option<bool> {
    let uv = find_tool("uv")?;
    let (ok, out) = run(&uv, &["tool", "list", "--show-extras"]);
    if !ok { return None; }
    out.lines().find(|l| l.trim_start().starts_with("headroom-ai")).map(|l| l.contains("proxy"))
}

pub fn check() -> Vec<ToolStatus> {
    let uv = version_of("uv");
    let headroom = version_of("headroom");
    // 본체만 있고 프록시 구성요소(fastapi 등)가 없으면 프록시가 즉시 종료되므로 미설치로 취급
    let missing_proxy = headroom.is_some() && headroom_proxy_extra() == Some(false);
    vec![
        ToolStatus {
            id: "uv".into(),
            name: "uv (Python 패키지/도구 관리자)".into(),
            installed: uv.is_some(),
            version: uv.clone(),
            requires: None,
            requires_met: true,
            install_command: if cfg!(windows) {
                format!("powershell -ExecutionPolicy Bypass -c \"{UV_INSTALL_WIN}\"")
            } else {
                "curl -LsSf https://astral.sh/uv/install.sh | sh".into()
            },
        },
        ToolStatus {
            id: "headroom".into(),
            name: "Headroom (토큰 최적화 프록시/MCP)".into(),
            installed: headroom.is_some() && !missing_proxy,
            version: if missing_proxy { headroom.map(|v| format!("{v} · 프록시 구성요소 누락")) } else { headroom },
            requires: Some("uv".into()),
            requires_met: uv.is_some(),
            install_command: format!("uv tool install \"{HEADROOM_SPEC}\""),
        },
    ]
}

pub fn install(id: &str) -> InstallResult {
    match id {
        "uv" => {
            let (ok, out) = if cfg!(windows) {
                run(
                    std::path::Path::new("powershell.exe"),
                    &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", UV_INSTALL_WIN],
                )
            } else {
                run(std::path::Path::new("sh"), &["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"])
            };
            InstallResult { ok: ok && find_tool("uv").is_some(), output: out }
        }
        "headroom" => {
            let Some(uv) = find_tool("uv") else {
                return InstallResult { ok: false, output: "uv가 필요합니다. 먼저 uv를 설치해 주세요.".into() };
            };
            let (ok, out) = run(&uv, &["tool", "install", "--force", HEADROOM_SPEC]);
            InstallResult { ok: ok && find_tool("headroom").is_some(), output: out }
        }
        _ => InstallResult { ok: false, output: format!("알 수 없는 도구: {id}") },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_lists_uv_then_headroom_with_dependency_flag() {
        let tools = check();
        assert_eq!(tools[0].id, "uv");
        assert_eq!(tools[1].id, "headroom");
        assert_eq!(tools[1].requires_met, tools[0].installed);
        assert!(tools[1].install_command.contains("headroom-ai"));
    }

    #[test]
    fn install_rejects_unknown_tool() {
        assert!(!install("nope").ok);
    }
}
