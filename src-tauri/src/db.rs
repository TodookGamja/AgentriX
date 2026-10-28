use crate::cli::CliDefinition;
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use chrono::{Duration, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub fn get_db_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AI_CLI_Manager")
        .join("ai_cli_manager_v2.db")
}

pub fn init_db() -> Result<Connection> {
    let db_path = get_db_path();
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = init_db_at(&db_path)?;
    Ok(conn)
}

pub fn init_db_at(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    setup_schema(&conn)?;
    seed_defaults(&conn)?;
    Ok(conn)
}

pub fn setup_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS custom_clis (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            binary_cmd TEXT NOT NULL,
            args_json TEXT NOT NULL DEFAULT '[]',
            env_keys_json TEXT NOT NULL DEFAULT '[]',
            login_command TEXT NOT NULL DEFAULT '',
            config_path TEXT NOT NULL DEFAULT '',
            skills_dir TEXT NOT NULL DEFAULT '',
            log_path TEXT NOT NULL DEFAULT '',
            accent_color TEXT NOT NULL DEFAULT '#6366f1',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            cli_id TEXT NOT NULL,
            key_name TEXT NOT NULL,
            cipher_value TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (cli_id, key_name)
        );

        CREATE TABLE IF NOT EXISTS usage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_hash TEXT UNIQUE NOT NULL,
            cli_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            model_name TEXT NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cache_tokens INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0.0
        );

        CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_usage_cli ON usage_logs(cli_id);

        CREATE TABLE IF NOT EXISTS registry_items (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            is_token_saver INTEGER NOT NULL DEFAULT 0,
            is_builtin INTEGER NOT NULL DEFAULT 0,
            config_json TEXT NOT NULL,
            applied_clis_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS config_backups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cli_id TEXT NOT NULL,
            original_path TEXT NOT NULL,
            backup_path TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS team_members (
            member_id TEXT PRIMARY KEY,
            member_name TEXT NOT NULL,
            role TEXT NOT NULL,
            department TEXT NOT NULL,
            favorite_cli TEXT NOT NULL,
            rolling_5h_tokens INTEGER NOT NULL DEFAULT 0,
            weekly_tokens INTEGER NOT NULL DEFAULT 0,
            saved_tokens_pct REAL NOT NULL DEFAULT 0.0,
            cost_usd REAL NOT NULL DEFAULT 0.0,
            headroom_active INTEGER NOT NULL DEFAULT 1,
            caveman_active INTEGER NOT NULL DEFAULT 1,
            synced_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_projects (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            last_used_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_agents (
            id TEXT PRIMARY KEY,
            project_path TEXT NOT NULL,
            name TEXT NOT NULL,
            role_title TEXT NOT NULL,
            cli_id TEXT NOT NULL,
            use_wrapper INTEGER NOT NULL DEFAULT 1,
            avatar_emoji TEXT NOT NULL DEFAULT '🤖',
            accent_color TEXT NOT NULL DEFAULT '#6366f1',
            role_prompt TEXT NOT NULL,
            auto_brief INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_project_agents_path ON project_agents(project_path);
        ",
    )?;
    // v1.0.5: 에이전트별 실행 모델 (이미 있으면 오류 무시)
    let _ = conn.execute("ALTER TABLE project_agents ADD COLUMN model TEXT NOT NULL DEFAULT ''", []);
    Ok(())
}

fn seed_defaults(conn: &Connection) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let home = crate::cli::home_dir();
    let local_headroom = home.join(".local").join("bin").join("headroom.exe");
    let headroom_cmd = if local_headroom.exists() {
        local_headroom.to_string_lossy().to_string()
    } else {
        "headroom".to_string()
    };

    // 요구사항 6: Headroom(MCP), Caveman(스킬) 토큰 관리 도구는 기본 활성화(enabled=1) 상태로 등록
    let headroom_cfg = serde_json::json!({
        "command": headroom_cmd,
        "args": ["mcp", "serve"],
        "env": {
            "HEADROOM_PROXY_URL": "http://127.0.0.1:8788"
        }
    });

    let caveman_cfg = serde_json::json!({
        "skillFolder": "caveman-token-saver",
        "skillMarkdown": "---\nname: caveman\ndescription: Ultra-concise token optimization mode. Eliminates filler prose and redundant code explanations.\n---\n\n# Caveman Token Saver Skill\n\nRules for minimal token consumption:\n1. Respond with direct code/diffs first; omit conversational pleasantries.\n2. Do not repeat unchanged code blocks.\n3. Summarize multi-file inspections in compact bullet points.\n4. Target 45-65% output token reduction without losing technical accuracy.\n"
    });

    let defaults = vec![
        (
            "headroom-mcp",
            "mcp",
            "Headroom (Token Optimizer MCP & Proxy)",
            "로컬 Headroom 프록시(127.0.0.1:8788) 및 MCP 서버(`headroom.exe mcp serve`)를 통해 컨텍스트 압축 및 캐시 효율을 극대화하는 기본 도구",
            1,
            1,
            1,
            headroom_cfg.to_string(),
            r#"["claude","codex","grok","antigravity","cursor","opencode"]"#,
        ),
        (
            "caveman-skill",
            "skill",
            "Caveman (Concise Output Skill)",
            "불필요한 서론·중복 코드 출력을 억제하여 출력 토큰과 응답 지연을 대폭 줄이는 기본 스킬",
            1,
            1,
            1,
            caveman_cfg.to_string(),
            r#"["claude","codex","grok","cursor","antigravity"]"#,
        ),
    ];

    for (id, kind, name, desc, enabled, is_saver, is_builtin, cfg, applied) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO registry_items
             (id, kind, name, description, enabled, is_token_saver, is_builtin, config_json, applied_clis_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![id, kind, name, desc, enabled, is_saver, is_builtin, cfg, applied, now],
        )?;
    }

    let _ = conn.execute(
        "UPDATE registry_items SET applied_clis_json = '[\"claude\",\"codex\",\"grok\",\"antigravity\",\"cursor\",\"opencode\"]' WHERE id = 'headroom-mcp' AND applied_clis_json NOT LIKE '%antigravity%'",
        [],
    );

    // 가짜 샘플 팀원 데이터 완전 삭제
    let _ = conn.execute("DELETE FROM team_members WHERE member_id LIKE 'member-%'", []);

    let _ = conn.execute(
        "DELETE FROM usage_logs WHERE event_hash LIKE 'claude_statscache_%' OR event_hash LIKE 'baseline_%'",
        [],
    );
    let _ = conn.execute(
        "DELETE FROM project_agents WHERE id LIKE 'md-%' OR name LIKE 'Michael%' OR name LIKE 'Dwight%' OR name LIKE 'Pam%' OR name LIKE 'Jim%' OR name LIKE 'Oscar%' OR name LIKE 'Angela%'",
        [],
    );

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolderRecord {
    pub path: String,
    pub name: String,
    pub last_used_at: String,
}

pub fn is_forbidden_system_dir(path_str: &str) -> bool {
    let lower = path_str.trim().replace('/', "\\").to_lowercase();
    lower.starts_with("c:\\windows") || lower == "c:\\"
}

pub fn default_safe_project_dir() -> String {
    let home = crate::cli::home_dir();
    home.to_string_lossy().to_string()
}

pub fn get_project_folders(conn: &Connection) -> Result<Vec<ProjectFolderRecord>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, last_used_at
         FROM user_projects
         ORDER BY last_used_at DESC, name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ProjectFolderRecord {
            path: row.get(0)?,
            name: row.get(1)?,
            last_used_at: row.get(2)?,
        })
    })?;
    let list: Vec<ProjectFolderRecord> = rows
        .flatten()
        .filter(|r| !is_forbidden_system_dir(&r.path) && Path::new(&r.path).is_dir())
        .collect();

    Ok(list)
}

pub fn upsert_project_folder(conn: &Connection, raw_path: &str) -> Result<Vec<ProjectFolderRecord>> {
    let trimmed = raw_path.trim().replace('/', "\\");
    if trimmed.is_empty() {
        anyhow::bail!("폴더 경로를 입력해 주세요.");
    }
    if is_forbidden_system_dir(&trimmed) {
        anyhow::bail!("Windows 시스템 폴더(C:\\Windows)는 작업 폴더로 지정할 수 없습니다.");
    }
    let path_obj = Path::new(&trimmed);
    if !path_obj.exists() || !path_obj.is_dir() {
        anyhow::bail!("존재하지 않는 폴더 경로입니다: {}", trimmed);
    }
    let name = path_obj
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&trimmed)
        .to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO user_projects (path, name, last_used_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            last_used_at = excluded.last_used_at",
        params![trimmed, name, now],
    )?;
    get_project_folders(conn)
}

pub fn delete_project_folder(conn: &Connection, path: &str) -> Result<Vec<ProjectFolderRecord>> {
    conn.execute("DELETE FROM user_projects WHERE path = ?1", params![path])?;
    get_project_folders(conn)
}

// --- 프로젝트별 AI 에이전트 (역할 부여 & 해당 프로젝트 전용 하네스) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAgentRecord {
    pub id: String,
    pub project_path: String,
    pub name: String,
    pub role_title: String,
    pub cli_id: String,
    pub use_wrapper: bool,
    pub avatar_emoji: String,
    pub accent_color: String,
    pub role_prompt: String,
    pub auto_brief: bool,
    pub created_at: String,
    /// 실행 모델 (빈 문자열 = CLI 기본 모델)
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAgentInput {
    pub id: Option<String>,
    pub project_path: String,
    pub name: String,
    pub role_title: String,
    pub cli_id: String,
    pub use_wrapper: bool,
    pub avatar_emoji: String,
    pub accent_color: String,
    pub role_prompt: String,
    pub auto_brief: bool,
    #[serde(default)]
    pub model: String,
}

pub fn normalize_project_path(raw: &str) -> String {
    let mut s = raw.trim().replace('/', "\\");
    while s.ends_with('\\') && s.len() > 3 {
        s.pop();
    }
    if s.len() >= 2 && s.as_bytes()[1] == b':' {
        let drive = (s.as_bytes()[0] as char).to_ascii_uppercase();
        s.replace_range(0..1, &drive.to_string());
    }
    s
}

pub fn sync_agent_files_on_disk(agent: &ProjectAgentRecord) {
    let proj_dir = PathBuf::from(&agent.project_path);
    if !proj_dir.is_dir() || is_forbidden_system_dir(&agent.project_path) {
        return;
    }
    let harness_dir = proj_dir.join(".ai-agents");
    let agent_dir = harness_dir.join("agents").join(&agent.id);
    let _ = std::fs::create_dir_all(&agent_dir);

    let proj_name = proj_dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Project");

    let role_md = format!(
        "# {} {} — {}\n\n- **소속 프로젝트**: `{}` (`{}`)\n- **담당 CLI 엔진**: `{}`{}\n- **에이전트 ID**: `{}`\n\n## 전담 역할 및 행동 지침 (Role & Instructions)\n\n{}\n\n## 협업 규칙 (Project Multi-Agent Protocol)\n1. 이 역할과 지침은 **`{}` 프로젝트에만 한정**하여 적용됩니다.\n2. 타 에이전트와의 주요 결정사항·진행상태 공유는 `.ai-agents/BLACKBOARD.md` 파일을 참고하거나 기록하세요.\n3. 자신의 담당 영역(`{}`)에 집중하여 명확하고 검증 가능한 결과를 도출하세요.\n",
        agent.avatar_emoji,
        agent.name,
        agent.role_title,
        proj_name,
        agent.project_path,
        agent.cli_id,
        if agent.use_wrapper { " (Headroom Proxy Wrapper)" } else { "" },
        agent.id,
        agent.role_prompt,
        proj_name,
        agent.role_title
    );
    let _ = std::fs::write(agent_dir.join("ROLE.md"), role_md);

    let blackboard_path = harness_dir.join("BLACKBOARD.md");
    if !blackboard_path.exists() {
        let initial_board = format!(
            "# 📋 {} — 프로젝트 공유 블랙보드 (Shared Agent Blackboard)\n\n> 이 파일(`.ai-agents/BLACKBOARD.md`)은 **{}** 프로젝트에 배정된 AI 에이전트들이 목표, 아키텍처 결정, 작업 인수인계를 공유하는 공간입니다.\n\n## 🎯 현재 프로젝트 목표\n- 프로젝트 경로: `{}`\n- 총괄 아키텍트 및 실무 에이전트들이 아래에 진행 상황을 업데이트합니다.\n\n## 📌 에이전트 간 공유 메모 & 작업 현황\n- [ ] 초기 아키텍처 및 작업 분배 점검\n",
            proj_name, proj_name, agent.project_path
        );
        let _ = std::fs::write(&blackboard_path, initial_board);
    }
}

pub fn get_project_agents(conn: &Connection, project_path: &str) -> Result<Vec<ProjectAgentRecord>> {
    let norm = normalize_project_path(project_path);
    let norm_lower = norm.to_lowercase();
    let mut stmt = conn.prepare(
        "SELECT id, project_path, name, role_title, cli_id, use_wrapper, avatar_emoji, accent_color, role_prompt, auto_brief, created_at, model
         FROM project_agents
         WHERE LOWER(REPLACE(project_path, '/', '\\')) = ?1
         ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![norm_lower], |row| {
        Ok(ProjectAgentRecord {
            id: row.get(0)?,
            project_path: row.get(1)?,
            name: row.get(2)?,
            role_title: row.get(3)?,
            cli_id: row.get(4)?,
            use_wrapper: row.get::<_, i64>(5)? != 0,
            avatar_emoji: row.get(6)?,
            accent_color: row.get(7)?,
            role_prompt: row.get(8)?,
            auto_brief: row.get::<_, i64>(9)? != 0,
            created_at: row.get(10)?,
            model: row.get(11)?,
        })
    })?;
    Ok(rows.flatten().collect())
}

pub fn upsert_project_agent(
    conn: &Connection,
    input: &ProjectAgentInput,
) -> Result<Vec<ProjectAgentRecord>> {
    let norm_path = normalize_project_path(&input.project_path);
    if norm_path.is_empty() || is_forbidden_system_dir(&norm_path) {
        anyhow::bail!("유효한 프로젝트 폴더를 먼저 선택해 주세요.");
    }
    if input.name.trim().is_empty() || input.role_title.trim().is_empty() {
        anyhow::bail!("에이전트 이름과 역할을 입력해 주세요.");
    }

    let id = input
        .id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("agent-{}", uuid::Uuid::new_v4().to_string()[..8].to_string()));
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO project_agents
         (id, project_path, name, role_title, cli_id, use_wrapper, avatar_emoji, accent_color, role_prompt, auto_brief, created_at, model)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
            project_path = excluded.project_path,
            name = excluded.name,
            role_title = excluded.role_title,
            cli_id = excluded.cli_id,
            use_wrapper = excluded.use_wrapper,
            avatar_emoji = excluded.avatar_emoji,
            accent_color = excluded.accent_color,
            role_prompt = excluded.role_prompt,
            auto_brief = excluded.auto_brief,
            model = excluded.model",
        params![
            id,
            norm_path,
            input.name.trim(),
            input.role_title.trim(),
            input.cli_id.trim(),
            if input.use_wrapper { 1 } else { 0 },
            if input.avatar_emoji.trim().is_empty() { "🤖" } else { input.avatar_emoji.trim() },
            if input.accent_color.trim().is_empty() { "#6366f1" } else { input.accent_color.trim() },
            input.role_prompt.trim(),
            if input.auto_brief { 1 } else { 0 },
            now,
            input.model.trim()
        ],
    )?;

    let list = get_project_agents(conn, &norm_path)?;
    if let Some(saved) = list.iter().find(|a| a.id == id) {
        sync_agent_files_on_disk(saved);
    }
    Ok(list)
}

pub fn delete_project_agent(
    conn: &Connection,
    project_path: &str,
    agent_id: &str,
) -> Result<Vec<ProjectAgentRecord>> {
    let norm = normalize_project_path(project_path);
    let norm_lower = norm.to_lowercase();
    conn.execute(
        "DELETE FROM project_agents WHERE id = ?1 AND LOWER(REPLACE(project_path, '/', '\\')) = ?2",
        params![agent_id, norm_lower],
    )?;
    get_project_agents(conn, &norm)
}

pub fn seed_project_agents_preset(
    conn: &Connection,
    project_path: &str,
) -> Result<Vec<ProjectAgentRecord>> {
    let norm = normalize_project_path(project_path);
    if norm.is_empty() || is_forbidden_system_dir(&norm) {
        anyhow::bail!("유효한 프로젝트 폴더를 먼저 선택해 주세요.");
    }
    let proj_name = Path::new(&norm)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Project");

    let presets = vec![
        ProjectAgentInput {
            id: Some(format!("role-pm-{}", proj_name.to_lowercase().replace(' ', "-"))),
            project_path: norm.clone(),
            name: "총괄 PM & 아키텍트".into(),
            role_title: "시스템 설계 · 요구사항 분해 · 총괄 리더".into(),
            cli_id: "claude".into(),
            use_wrapper: true,
            avatar_emoji: "👑".into(),
            accent_color: "#f97316".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트의 총괄 리더 겸 시스템 아키텍트입니다. 전체 요구사항을 분석하여 모듈 단위로 작업을 분해하고, 핵심 구조 설계와 `.ai-agents/BLACKBOARD.md` 업데이트 및 품질 승인을 총괄하세요.",
                proj_name
            ),
            auto_brief: true,
            model: String::new(),
        },
        ProjectAgentInput {
            id: Some(format!("role-backend-{}", proj_name.to_lowercase().replace(' ', "-"))),
            project_path: norm.clone(),
            name: "수석 백엔드 엔지니어".into(),
            role_title: "핵심 비즈니스 로직 · API · 서버 구현".into(),
            cli_id: "codex".into(),
            use_wrapper: true,
            avatar_emoji: "🛠️".into(),
            accent_color: "#10b981".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트의 수석 백엔드 및 핵심 알고리즘 엔지니어입니다. API, 데이터베이스, 비즈니스 로직, 리팩토링 및 고성능 코드 구현을 전담하세요.",
                proj_name
            ),
            auto_brief: true,
            model: String::new(),
        },
        ProjectAgentInput {
            id: Some(format!("role-frontend-{}", proj_name.to_lowercase().replace(' ', "-"))),
            project_path: norm.clone(),
            name: "프론트엔드 & UI 엔지니어".into(),
            role_title: "화면 컴포넌트 · 상태 관리 · UX 디자인".into(),
            cli_id: "antigravity".into(),
            use_wrapper: false,
            avatar_emoji: "🎨".into(),
            accent_color: "#8b5cf6".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트의 프론트엔드 및 UI/UX 전담 엔지니어입니다. 화면 레이아웃, 컴포넌트 상태 관리, 반응형 스타일링 및 사용자 경험 개선을 전담하세요.",
                proj_name
            ),
            auto_brief: true,
            model: String::new(),
        },
        ProjectAgentInput {
            id: Some(format!("role-qa-{}", proj_name.to_lowercase().replace(' ', "-"))),
            project_path: norm.clone(),
            name: "QA & 코드 리뷰어".into(),
            role_title: "엣지 케이스 검증 · 테스트 · 디버깅".into(),
            cli_id: "grok".into(),
            use_wrapper: true,
            avatar_emoji: "🔍".into(),
            accent_color: "#ef4444".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트의 QA 및 코드 리뷰어입니다. 구현된 코드의 엣지 케이스, 런타임 에러, 보안 취약점을 추적하고 자동화 테스트를 작성·검증하세요.",
                proj_name
            ),
            auto_brief: true,
            model: String::new(),
        },
    ];

    for p in presets {
        let _ = upsert_project_agent(conn, &p)?;
    }

    get_project_agents(conn, &norm)
}

pub fn get_project_blackboard(project_path: &str) -> Result<String> {
    let norm = normalize_project_path(project_path);
    let board_path = Path::new(&norm).join(".ai-agents").join("BLACKBOARD.md");
    if board_path.is_file() {
        Ok(std::fs::read_to_string(&board_path)?)
    } else {
        let proj_name = Path::new(&norm)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Project");
        Ok(format!(
            "# 📋 {} — 프로젝트 공유 블랙보드 (Shared Agent Blackboard)\n\n## 🎯 현재 프로젝트 목표\n- 프로젝트 경로: `{}`\n\n## 📌 에이전트 간 공유 메모 & 작업 현황\n- [ ] 에이전트 역할 배정 및 작업 시작\n",
            proj_name, norm
        ))
    }
}

pub fn save_project_blackboard(project_path: &str, content: &str) -> Result<()> {
    let norm = normalize_project_path(project_path);
    if norm.is_empty() || is_forbidden_system_dir(&norm) {
        anyhow::bail!("유효한 프로젝트 폴더가 아닙니다.");
    }
    let dir = Path::new(&norm).join(".ai-agents");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("BLACKBOARD.md"), content)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeepContext {
    pub project_name: String,
    pub project_path: String,
    pub readme_snippet: Option<String>,
    pub manifest_snippet: Option<String>,
    pub file_tree: Vec<String>,
    pub detected_stacks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalysisResult {
    pub project_path: String,
    pub project_name: String,
    pub detected_stacks: Vec<String>,
    pub summary_description: String,
    pub top_entries: Vec<String>,
    pub recommended_agents: Vec<ProjectAgentInput>,
}

pub fn analyze_project_workspace(project_path: &str) -> Result<ProjectAnalysisResult> {
    let norm = normalize_project_path(project_path);
    let root = Path::new(&norm);
    let project_name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Project")
        .to_string();

    let mut stacks: Vec<String> = Vec::new();
    let mut top_entries: Vec<String> = Vec::new();
    let mut has_frontend = false;
    let mut has_backend_node = false;
    let mut has_python = false;
    let mut has_rust = false;
    let mut has_db = false;

    if root.is_dir() {
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten().take(24) {
                let fname = entry.file_name().to_string_lossy().to_string();
                if !fname.starts_with('.') || fname == ".ai-agents" {
                    let prefix = if entry.path().is_dir() { "📁 " } else { "📄 " };
                    top_entries.push(format!("{}{}", prefix, fname));
                }
            }
        }

        // package.json 분석
        let pkg_json = root.join("package.json");
        if pkg_json.is_file() {
            if let Ok(raw) = std::fs::read_to_string(&pkg_json) {
                let lower = raw.to_lowercase();
                if lower.contains("\"typescript\"") || root.join("tsconfig.json").exists() {
                    stacks.push("TypeScript".into());
                } else {
                    stacks.push("JavaScript (Node.js)".into());
                }
                if lower.contains("\"next\"") {
                    stacks.push("Next.js".into());
                    has_frontend = true;
                    has_backend_node = true;
                }
                if lower.contains("\"react\"") {
                    stacks.push("React".into());
                    has_frontend = true;
                }
                if lower.contains("\"vue\"") {
                    stacks.push("Vue.js".into());
                    has_frontend = true;
                }
                if lower.contains("\"tailwindcss\"") {
                    stacks.push("Tailwind CSS".into());
                }
                if lower.contains("\"vite\"") {
                    stacks.push("Vite".into());
                }
                if lower.contains("\"express\"") || lower.contains("\"nestjs\"") || lower.contains("\"fastify\"") {
                    stacks.push("Node.js API Server".into());
                    has_backend_node = true;
                }
                if lower.contains("\"prisma\"") || lower.contains("\"drizzle\"") || lower.contains("\"supabase\"") || lower.contains("\"sqlite\"") {
                    stacks.push("DB / ORM".into());
                    has_db = true;
                }
            }
        }

        // Cargo.toml / src-tauri 분석
        if root.join("Cargo.toml").exists() || root.join("src-tauri").exists() {
            stacks.push("Rust".into());
            has_rust = true;
            if root.join("src-tauri").exists() {
                stacks.push("Tauri 2 Desktop".into());
            }
        }

        // Python 프로젝트 분석
        if root.join("pyproject.toml").exists()
            || root.join("requirements.txt").exists()
            || root.join("main.py").exists()
            || root.join("app.py").exists()
        {
            stacks.push("Python".into());
            has_python = true;
            for cfg_name in ["pyproject.toml", "requirements.txt"] {
                let p = root.join(cfg_name);
                if p.is_file() {
                    if let Ok(raw) = std::fs::read_to_string(&p) {
                        let lower = raw.to_lowercase();
                        if lower.contains("fastapi") || lower.contains("uvicorn") {
                            stacks.push("FastAPI".into());
                        }
                        if lower.contains("torch") || lower.contains("transformers") || lower.contains("openai") || lower.contains("anthropic") {
                            stacks.push("AI / LLM Pipeline".into());
                        }
                        if lower.contains("yt-dlp") || lower.contains("moviepy") || lower.contains("ffmpeg") {
                            stacks.push("Media / Video Processing".into());
                        }
                    }
                }
            }
        }

        if root.join(".git").exists() {
            stacks.push("Git".into());
        }
    }

    if stacks.is_empty() {
        stacks.push("General Software Project".into());
    }

    let summary_description = format!(
        "'{}' 프로젝트에서 감지된 기술 스택({})을 기반으로 최적화된 역할별 AI 에이전트 후보군을 추천합니다. 원하는 에이전트만 골라 이 프로젝트에 추가하거나 역할을 수정해 사용하세요.",
        project_name,
        stacks.join(" · ")
    );

    let slug = project_name.to_lowercase().replace(' ', "-");
    let mut recommended: Vec<ProjectAgentInput> = Vec::new();

    // 1. 총괄 PM & 아키텍트 (항상 추천)
    recommended.push(ProjectAgentInput {
        id: Some(format!("rec-pm-{}", slug)),
        project_path: norm.clone(),
        name: "총괄 PM & 아키텍트".into(),
        role_title: format!("{} 아키텍처 설계 & 업무 분배 리더", project_name),
        cli_id: "claude".into(),
        use_wrapper: true,
        avatar_emoji: "👑".into(),
        accent_color: "#f97316".into(),
        role_prompt: format!(
            "당신은 '{}' 프로젝트({})의 총괄 리더 겸 시스템 아키텍트입니다. 요구사항을 분석하여 하위 작업으로 분해하고, 아키텍처 설계 결정과 에이전트 간 협업 현황을 `.ai-agents/BLACKBOARD.md`에 정리하세요.",
            project_name,
            stacks.join(", ")
        ),
        auto_brief: true,
        model: String::new(),
    });

    // 2. 스택 맞춤형 백엔드/코어 에이전트 추천
    if has_python {
        recommended.push(ProjectAgentInput {
            id: Some(format!("rec-py-{}", slug)),
            project_path: norm.clone(),
            name: "Python · AI 파이프라인 엔지니어".into(),
            role_title: "Python 백엔드 & AI/미디어 파이프라인 전담".into(),
            cli_id: "codex".into(),
            use_wrapper: true,
            avatar_emoji: "🐍".into(),
            accent_color: "#10b981".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트의 Python 백엔드 및 AI/데이터 파이프라인 수석 엔지니어입니다. 비동기 처리, API 연동, 데이터 가공 및 스크립트 안정성 최적화를 전담하세요.",
                project_name
            ),
            auto_brief: true,
            model: String::new(),
        });
    } else if has_rust {
        recommended.push(ProjectAgentInput {
            id: Some(format!("rec-rust-{}", slug)),
            project_path: norm.clone(),
            name: "Rust · 시스템 코어 엔지니어".into(),
            role_title: "Rust 백엔드 & 시스템/성능 최적화 전담".into(),
            cli_id: "codex".into(),
            use_wrapper: true,
            avatar_emoji: "🦀".into(),
            accent_color: "#10b981".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트의 Rust 시스템 아키텍트입니다. 메모리 안전성, 비동기/멀티스레드 처리, IPC 브리지 및 백엔드 성능 최적화를 전담하세요.",
                project_name
            ),
            auto_brief: true,
            model: String::new(),
        });
    } else {
        recommended.push(ProjectAgentInput {
            id: Some(format!("rec-core-{}", slug)),
            project_path: norm.clone(),
            name: "수석 백엔드 & 코어 엔지니어".into(),
            role_title: "핵심 비즈니스 로직 & API 아키텍트".into(),
            cli_id: "codex".into(),
            use_wrapper: true,
            avatar_emoji: "🛠️".into(),
            accent_color: "#10b981".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트({})의 수석 백엔드 및 핵심 알고리즘 엔지니어입니다. 서버 API, 데이터 모델링, 비즈니스 로직 구현 및 리팩토링을 전담하세요.",
                project_name,
                stacks.join(", ")
            ),
            auto_brief: true,
            model: String::new(),
        });
    }

    // 3. 프론트엔드 / UI·UX 에이전트 추천
    if has_frontend {
        recommended.push(ProjectAgentInput {
            id: Some(format!("rec-ui-{}", slug)),
            project_path: norm.clone(),
            name: "프론트엔드 & UI/UX 엔지니어".into(),
            role_title: "React/TypeScript 컴포넌트 & 디자인 시스템".into(),
            cli_id: "antigravity".into(),
            use_wrapper: false,
            avatar_emoji: "🎨".into(),
            accent_color: "#8b5cf6".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트의 프론트엔드 및 UI/UX 전담 엔지니어입니다. 화면 레이아웃, 상태 관리, 반응형 스타일링 및 사용자 인터랙션 완성도를 책임지세요.",
                project_name
            ),
            auto_brief: true,
            model: String::new(),
        });
    } else {
        recommended.push(ProjectAgentInput {
            id: Some(format!("rec-ux-{}", slug)),
            project_path: norm.clone(),
            name: "클라이언트 & 인터페이스 엔지니어".into(),
            role_title: "클라이언트 연동 · CLI/UI 인터페이스 & 문서화".into(),
            cli_id: "antigravity".into(),
            use_wrapper: false,
            avatar_emoji: "🎨".into(),
            accent_color: "#8b5cf6".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트의 사용자 인터페이스 및 기술 문서화 전담 에이전트입니다. 직관적인 입출력 구조와 명확한 가이드를 설계·구현하세요.",
                project_name
            ),
            auto_brief: true,
            model: String::new(),
        });
    }

    // 4. QA & 버그 헌터 (Grok CLI)
    recommended.push(ProjectAgentInput {
        id: Some(format!("rec-qa-{}", slug)),
        project_path: norm.clone(),
        name: "QA & 코드 리뷰어".into(),
        role_title: "엣지 케이스 검증 · 테스트 작성 · 디버깅".into(),
        cli_id: "grok".into(),
        use_wrapper: true,
        avatar_emoji: "🔍".into(),
        accent_color: "#ef4444".into(),
        role_prompt: format!(
            "당신은 '{}' 프로젝트의 QA 리드 및 코드 리뷰어입니다. 변경된 코드의 버그, 타입 불일치, 예외 처리 누락을 날카롭게 찾아내고 테스트로 검증하세요.",
            project_name
        ),
        auto_brief: true,
        model: String::new(),
    });

    // 5. DB / 성능 / 보안 스페셜리스트 (추가 선택용)
    if has_db || has_backend_node || has_python {
        recommended.push(ProjectAgentInput {
            id: Some(format!("rec-data-{}", slug)),
            project_path: norm.clone(),
            name: "데이터 & DB 최적화 엔지니어".into(),
            role_title: "스키마 설계 · 캐싱 · 토큰/비용 최적화".into(),
            cli_id: "claude".into(),
            use_wrapper: true,
            avatar_emoji: "📊".into(),
            accent_color: "#06b6d4".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트의 데이터 및 성능 최적화 전문가입니다. 데이터베이스 스키마, 쿼리 성능, API 응답 속도 및 비용 효율성을 집중 개선하세요.",
                project_name
            ),
            auto_brief: true,
            model: String::new(),
        });
    } else {
        recommended.push(ProjectAgentInput {
            id: Some(format!("rec-sec-{}", slug)),
            project_path: norm.clone(),
            name: "보안 감사 & 빌드 품질 엔지니어".into(),
            role_title: "보안 취약점 점검 · 린트/빌드 무결성 관리".into(),
            cli_id: "claude".into(),
            use_wrapper: true,
            avatar_emoji: "🛡️".into(),
            accent_color: "#eab308".into(),
            role_prompt: format!(
                "당신은 '{}' 프로젝트의 보안 및 빌드 품질 관리자입니다. 시크릿 노출 방지, 의존성 점검, 컴파일/린트 무결성을 엄격하게 검증하세요.",
                project_name
            ),
            auto_brief: true,
            model: String::new(),
        });
    }

    Ok(ProjectAnalysisResult {
        project_path: norm,
        project_name,
        detected_stacks: stacks,
        summary_description,
        top_entries,
        recommended_agents: recommended,
    })
}

pub fn get_project_deep_context(project_path: &str) -> Result<ProjectDeepContext> {
    let norm = normalize_project_path(project_path);
    let root = Path::new(&norm);
    let project_name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Project")
        .to_string();

    let mut file_tree: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten().take(50) {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.starts_with('.') && fname != ".ai-agents" {
                continue;
            }
            let is_dir = entry.path().is_dir();
            file_tree.push(format!("{}{}", if is_dir { "[DIR] " } else { "[FILE] " }, fname));
        }
    }

    let readme_snippet = ["README.md", "readme.md", "README.txt"]
        .iter()
        .find_map(|f| {
            let p = root.join(f);
            if p.is_file() {
                std::fs::read_to_string(&p).ok().map(|s| {
                    if s.len() > 3000 {
                        s[..3000].to_string()
                    } else {
                        s
                    }
                })
            } else {
                None
            }
        });

    let manifest_snippet = ["package.json", "Cargo.toml", "pyproject.toml", "requirements.txt", "go.mod"]
        .iter()
        .find_map(|f| {
            let p = root.join(f);
            if p.is_file() {
                std::fs::read_to_string(&p).ok().map(|s| {
                    format!("--- {} ---\n{}", f, if s.len() > 2000 { &s[..2000] } else { &s })
                })
            } else {
                None
            }
        });

    let analysis = analyze_project_workspace(project_path)?;

    Ok(ProjectDeepContext {
        project_name,
        project_path: norm,
        readme_snippet,
        manifest_snippet,
        file_tree,
        detected_stacks: analysis.detected_stacks,
    })
}

// --- 사용자 정의 CLI 추가 / 삭제 / 조회 ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomCliInput {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub binary_cmd: String,
    pub args: Vec<String>,
    pub env_keys: Vec<String>,
    pub login_command: String,
    pub config_path: String,
    pub skills_dir: String,
    pub log_path: String,
    pub accent_color: String,
}

pub fn upsert_custom_cli(conn: &Connection, input: &CustomCliInput) -> Result<()> {
    let id = input.id.trim().to_lowercase().replace(' ', "-");
    if id.is_empty() || input.name.trim().is_empty() || input.binary_cmd.trim().is_empty() {
        anyhow::bail!("ID, 표시 이름, 실행 명령어(경로)는 필수입니다.");
    }
    let now = Utc::now().to_rfc3339();
    let args_json = serde_json::to_string(&input.args)?;
    let env_json = serde_json::to_string(&input.env_keys)?;
    let color = if input.accent_color.trim().is_empty() {
        "#06b6d4"
    } else {
        input.accent_color.trim()
    };

    conn.execute(
        "INSERT INTO custom_clis
         (id, name, provider, binary_cmd, args_json, env_keys_json, login_command, config_path, skills_dir, log_path, accent_color, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            provider = excluded.provider,
            binary_cmd = excluded.binary_cmd,
            args_json = excluded.args_json,
            env_keys_json = excluded.env_keys_json,
            login_command = excluded.login_command,
            config_path = excluded.config_path,
            skills_dir = excluded.skills_dir,
            log_path = excluded.log_path,
            accent_color = excluded.accent_color",
        params![
            id,
            input.name.trim(),
            if input.provider.trim().is_empty() { "Custom" } else { input.provider.trim() },
            input.binary_cmd.trim(),
            args_json,
            env_json,
            input.login_command.trim(),
            input.config_path.trim(),
            input.skills_dir.trim(),
            input.log_path.trim(),
            color,
            now
        ],
    )?;
    Ok(())
}

pub fn delete_custom_cli(conn: &Connection, cli_id: &str) -> Result<()> {
    conn.execute("DELETE FROM custom_clis WHERE id = ?1", params![cli_id])?;
    Ok(())
}

pub fn get_custom_clis(conn: &Connection) -> Result<Vec<CliDefinition>> {
    let home = crate::cli::home_dir();
    let mut stmt = conn.prepare(
        "SELECT id, name, provider, binary_cmd, args_json, env_keys_json, login_command, config_path, skills_dir, log_path, accent_color
         FROM custom_clis
         ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let binary_cmd: String = row.get(3)?;
        let args_raw: String = row.get(4)?;
        let env_raw: String = row.get(5)?;
        let login_cmd: String = row.get(6)?;
        let cfg_str: String = row.get(7)?;
        let skills_str: String = row.get(8)?;
        let log_str: String = row.get(9)?;

        let args: Vec<String> = serde_json::from_str(&args_raw).unwrap_or_default();
        let env_keys: Vec<String> = serde_json::from_str(&env_raw).unwrap_or_default();

        let config_path = if cfg_str.is_empty() {
            home.join(format!(".{}", id)).join("config.json")
        } else {
            PathBuf::from(&cfg_str)
        };
        let skills_dir = if skills_str.is_empty() {
            home.join(format!(".{}", id)).join("skills")
        } else {
            PathBuf::from(&skills_str)
        };
        let log_path = if log_str.is_empty() {
            home.join(format!(".{}", id)).join("logs")
        } else {
            PathBuf::from(&log_str)
        };

        Ok(CliDefinition {
            id: id.clone(),
            name: row.get(1)?,
            provider: row.get(2)?,
            binary_candidates: vec![binary_cmd.clone()],
            resolved_binary: None,
            wrapper_binary: None,
            installed: false,
            is_custom: true,
            args,
            env_keys,
            login_command: if login_cmd.is_empty() {
                format!("{} login", binary_cmd)
            } else {
                login_cmd
            },
            subscription_detected: config_path.exists(),
            config_path,
            skills_dir,
            log_path,
            accent_color: row.get(10)?,
        })
    })?;

    Ok(rows.flatten().collect())
}

// --- API Key 난독화/복호화 (평문 노출 방지) ---
fn cipher_secret() -> Vec<u8> {
    let host_salt = format!("ACM_SECRET_SALT_{}_v1", whoami::username());
    host_salt.into_bytes()
}

fn encrypt_key(plain: &str) -> String {
    let salt = cipher_secret();
    let xored: Vec<u8> = plain
        .as_bytes()
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ salt[i % salt.len()])
        .collect();
    B64.encode(xored)
}

fn decrypt_key(cipher: &str) -> Option<String> {
    let decoded = B64.decode(cipher.as_bytes()).ok()?;
    let salt = cipher_secret();
    let plain: Vec<u8> = decoded
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ salt[i % salt.len()])
        .collect();
    String::from_utf8(plain).ok()
}

fn mask_api_key(plain: &str) -> String {
    let trimmed = plain.trim();
    if trimmed.len() <= 8 {
        "••••••••".to_string()
    } else {
        format!("{}••••{}", &trimmed[..4], &trimmed[trimmed.len() - 4..])
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub cli_id: String,
    pub key_name: String,
    pub has_key: bool,
    pub masked_preview: Option<String>,
    pub updated_at: Option<String>,
}

pub fn save_api_key(conn: &Connection, cli_id: &str, key_name: &str, raw_key: &str) -> Result<ApiKeyStatus> {
    let cleaned = raw_key.trim();
    if cleaned.is_empty() {
        anyhow::bail!("API 키 값은 비어 있을 수 없습니다.");
    }
    let cipher = encrypt_key(cleaned);
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO api_keys (cli_id, key_name, cipher_value, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(cli_id, key_name) DO UPDATE SET
            cipher_value = excluded.cipher_value,
            updated_at = excluded.updated_at",
        params![cli_id, key_name, cipher, now],
    )?;

    Ok(ApiKeyStatus {
        cli_id: cli_id.to_string(),
        key_name: key_name.to_string(),
        has_key: true,
        masked_preview: Some(mask_api_key(cleaned)),
        updated_at: Some(now),
    })
}

pub fn delete_api_key(conn: &Connection, cli_id: &str, key_name: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM api_keys WHERE cli_id = ?1 AND key_name = ?2",
        params![cli_id, key_name],
    )?;
    Ok(())
}

pub fn get_api_keys_status(conn: &Connection) -> Result<Vec<ApiKeyStatus>> {
    let mut stored: HashMap<(String, String), (String, String)> = HashMap::new();
    let mut stmt = conn.prepare("SELECT cli_id, key_name, cipher_value, updated_at FROM api_keys")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    for r in rows.flatten() {
        stored.insert((r.0, r.1), (r.2, r.3));
    }

    let mut result = Vec::new();
    let all_clis = crate::cli::detect_all_clis_with_db(conn);
    for cli in all_clis {
        for key_name in cli.env_keys {
            if let Some((cipher, updated_at)) = stored.get(&(cli.id.clone(), key_name.clone())) {
                let preview = decrypt_key(cipher).map(|p| mask_api_key(&p));
                result.push(ApiKeyStatus {
                    cli_id: cli.id.clone(),
                    key_name,
                    has_key: true,
                    masked_preview: preview,
                    updated_at: Some(updated_at.clone()),
                });
            } else {
                result.push(ApiKeyStatus {
                    cli_id: cli.id.clone(),
                    key_name,
                    has_key: false,
                    masked_preview: None,
                    updated_at: None,
                });
            }
        }
    }

    Ok(result)
}

pub fn get_decrypted_env_for_cli(conn: &Connection, cli_id: &str) -> Result<HashMap<String, String>> {
    let mut env_map = HashMap::new();
    let mut stmt = conn.prepare("SELECT key_name, cipher_value FROM api_keys WHERE cli_id = ?1")?;
    let rows = stmt.query_map(params![cli_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in rows.flatten() {
        if let Some(plain) = decrypt_key(&row.1) {
            env_map.insert(row.0, plain);
        }
    }
    Ok(env_map)
}

// --- 사용량(Usage) 저장 및 다차원 집계 ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedUsageRecord {
    pub event_hash: String,
    pub cli_id: String,
    pub timestamp: String,
    pub model_name: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsagePoint {
    pub date: String,
    pub claude_tokens: u64,
    pub codex_tokens: u64,
    pub grok_tokens: u64,
    pub cursor_tokens: u64,
    pub antigravity_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBreakdownItem {
    pub model_name: String,
    pub cli_id: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUsageSummary {
    pub cli_id: String,
    pub current_tokens: u64,
    pub rolling_5h_tokens: u64,
    pub weekly_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubQuotaGroup {
    pub name: String,
    pub description: Option<String>,
    pub remaining_5h: Option<f64>,
    pub resets_at_5h: Option<String>,
    pub remaining_weekly: Option<f64>,
    pub resets_at_weekly: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliQuotaStatus {
    pub cli_id: String,
    pub cli_name: String,
    pub plan_label: String,
    pub source_label: String,
    pub has_official_quota: bool,
    pub used_percent_5h: f64,
    pub remaining_percent_5h: f64,
    pub resets_at_5h: Option<String>,
    pub used_percent_weekly: f64,
    pub remaining_percent_weekly: f64,
    pub resets_at_weekly: Option<String>,
    pub status_message: Option<String>,
    pub sub_groups: Option<Vec<SubQuotaGroup>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDashboardData {
    pub current_tokens: u64,
    pub rolling_5h_tokens: u64,
    pub rolling_5h_limit: u64,
    pub weekly_tokens: u64,
    pub weekly_limit: u64,
    pub total_cost_usd: f64,
    pub estimated_saved_tokens: u64,
    pub daily_history: Vec<DailyUsagePoint>,
    pub model_breakdown: Vec<ModelBreakdownItem>,
    pub cli_summaries: Vec<CliUsageSummary>,
    pub cli_quotas: Vec<CliQuotaStatus>,
    pub active_quota: Option<CliQuotaStatus>,
    pub recent_logs_count: u64,
    pub active_timeframe: Option<String>,
}

pub fn insert_usage_records(conn: &Connection, records: &[ParsedUsageRecord]) -> Result<usize> {
    if records.is_empty() {
        return Ok(0);
    }
    conn.execute_batch("BEGIN TRANSACTION;")?;
    let mut inserted = 0;
    {
        let mut stmt = conn.prepare_cached(
            "INSERT OR IGNORE INTO usage_logs
             (event_hash, cli_id, timestamp, model_name, input_tokens, output_tokens, cache_tokens, cost_usd)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for rec in records {
            let affected = stmt.execute(params![
                rec.event_hash,
                rec.cli_id,
                rec.timestamp,
                rec.model_name,
                rec.input_tokens as i64,
                rec.output_tokens as i64,
                rec.cache_tokens as i64,
                rec.cost_usd
            ])?;
            inserted += affected;
        }
    }
    conn.execute_batch("COMMIT;")?;
    Ok(inserted)
}

pub fn get_usage_dashboard(
    conn: &Connection,
    cli_filter: Option<&str>,
    timeframe: Option<&str>,
) -> Result<UsageDashboardData> {
    let now = Utc::now();
    let cutoff_1h = (now - Duration::hours(1)).to_rfc3339();
    let cutoff_5h = (now - Duration::hours(5)).to_rfc3339();
    let cutoff_24h = (now - Duration::hours(24)).to_rfc3339();
    let cutoff_7d = (now - Duration::days(7)).to_rfc3339();

    let active_tf = timeframe.unwrap_or("7d");
    let model_cutoff: &str = match active_tf {
        "5h" => &cutoff_5h,
        "24h" => &cutoff_24h,
        "7d" => &cutoff_7d,
        _ => "", // "all"
    };

    let mut stmt = conn.prepare(
        "SELECT cli_id, timestamp, model_name, input_tokens, output_tokens, cache_tokens, cost_usd
         FROM usage_logs
         ORDER BY timestamp ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)? as u64,
            row.get::<_, i64>(4)? as u64,
            row.get::<_, i64>(5)? as u64,
            row.get::<_, f64>(6)?,
        ))
    })?;

    let mut current_tokens = 0u64;
    let mut rolling_5h_tokens = 0u64;
    let mut weekly_tokens = 0u64;
    let mut total_cost_usd = 0.0f64;
    let mut recent_logs_count = 0u64;
    let mut timeframe_model_tokens = 0u64;

    let mut daily_map: HashMap<String, DailyUsagePoint> = HashMap::new();
    let mut model_map: HashMap<(String, String), ModelBreakdownItem> = HashMap::new();
    let mut cli_map: HashMap<String, CliUsageSummary> = HashMap::new();

    for id in ["claude", "codex", "grok", "cursor", "antigravity"] {
        cli_map.insert(
            id.to_string(),
            CliUsageSummary {
                cli_id: id.to_string(),
                current_tokens: 0,
                rolling_5h_tokens: 0,
                weekly_tokens: 0,
                total_tokens: 0,
                cost_usd: 0.0,
            },
        );
    }

    for r in rows.flatten() {
        let (cli_id, ts, model_name, inp, out, cache, cost) = r;
        let tok = inp + out + cache;

        let cli_entry = cli_map.entry(cli_id.clone()).or_insert(CliUsageSummary {
            cli_id: cli_id.clone(),
            current_tokens: 0,
            rolling_5h_tokens: 0,
            weekly_tokens: 0,
            total_tokens: 0,
            cost_usd: 0.0,
        });
        cli_entry.total_tokens += tok;
        cli_entry.cost_usd += cost;
        if ts >= cutoff_1h {
            cli_entry.current_tokens += tok;
        }
        if ts >= cutoff_5h {
            cli_entry.rolling_5h_tokens += tok;
        }
        if ts >= cutoff_7d {
            cli_entry.weekly_tokens += tok;
        }

        if let Some(filter) = cli_filter {
            if !filter.is_empty() && filter != "all" && filter != cli_id {
                continue;
            }
        }

        recent_logs_count += 1;
        total_cost_usd += cost;

        if ts >= cutoff_1h {
            current_tokens += tok;
        }
        if ts >= cutoff_5h {
            rolling_5h_tokens += tok;
        }
        if ts >= cutoff_7d {
            weekly_tokens += tok;
        }

        let date_key = if ts.len() >= 10 {
            ts[..10].to_string()
        } else {
            now.format("%Y-%m-%d").to_string()
        };

        let day_point = daily_map.entry(date_key.clone()).or_insert(DailyUsagePoint {
            date: date_key,
            claude_tokens: 0,
            codex_tokens: 0,
            grok_tokens: 0,
            cursor_tokens: 0,
            antigravity_tokens: 0,
            total_tokens: 0,
            cost_usd: 0.0,
        });
        match cli_id.as_str() {
            "claude" => day_point.claude_tokens += tok,
            "codex" => day_point.codex_tokens += tok,
            "grok" => day_point.grok_tokens += tok,
            "cursor" => day_point.cursor_tokens += tok,
            "antigravity" => day_point.antigravity_tokens += tok,
            _ => {}
        }
        day_point.total_tokens += tok;
        day_point.cost_usd += cost;

        // 모델별 브레이크다운: 선택된 활성 타임프레임(5h / 24h / 7d / all) + 개별 CLI 필터 적용
        if (model_cutoff.is_empty() || ts.as_str() >= model_cutoff)
            && cli_filter.map_or(true, |f| f.is_empty() || f == "all" || f == cli_id)
        {
            timeframe_model_tokens += tok;
            let model_entry = model_map
                .entry((model_name.clone(), cli_id.clone()))
                .or_insert(ModelBreakdownItem {
                    model_name,
                    cli_id,
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_tokens: 0,
                    total_tokens: 0,
                    cost_usd: 0.0,
                    percentage: 0.0,
                });
            model_entry.input_tokens += inp;
            model_entry.output_tokens += out;
            model_entry.cache_tokens += cache;
            model_entry.total_tokens += tok;
            model_entry.cost_usd += cost;
        }
    }

    let mut daily_history: Vec<DailyUsagePoint> = daily_map.into_values().collect();
    daily_history.sort_by(|a, b| a.date.cmp(&b.date));
    if daily_history.len() > 14 {
        daily_history = daily_history.split_off(daily_history.len() - 14);
    }

    let mut model_breakdown: Vec<ModelBreakdownItem> = model_map.into_values().collect();
    for item in &mut model_breakdown {
        if timeframe_model_tokens > 0 {
            item.percentage = ((item.total_tokens as f64 / timeframe_model_tokens as f64) * 1000.0).round() / 10.0;
        }
    }
    model_breakdown.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    let mut cli_summaries: Vec<CliUsageSummary> = cli_map.into_values().collect();
    cli_summaries.sort_by(|a, b| a.cli_id.cmp(&b.cli_id));

    let savers_enabled: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM registry_items WHERE is_token_saver = 1 AND enabled = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let saver_ratio = match savers_enabled {
        2.. => 0.42,
        1 => 0.24,
        _ => 0.0,
    };
    let estimated_saved_tokens = (weekly_tokens as f64 * saver_ratio) as u64;

    let _ = conn.execute(
        "UPDATE team_members
         SET rolling_5h_tokens = CASE WHEN ?1 > 0 THEN ?1 ELSE rolling_5h_tokens END,
             weekly_tokens = CASE WHEN ?2 > 0 THEN ?2 ELSE weekly_tokens END,
             cost_usd = CASE WHEN ?3 > 0.0 THEN ?3 ELSE cost_usd END,
             synced_at = ?4
         WHERE member_id = 'local-me'",
        params![
            rolling_5h_tokens as i64,
            weekly_tokens as i64,
            total_cost_usd,
            now.to_rfc3339()
        ],
    );

    let mut cli_quotas = crate::usage::collect_all_cli_quotas(false);
    for (extra_id, extra_name, extra_plan, extra_source) in [
        ("antigravity", "Antigravity (agy)", "Gemini", "~/.gemini/antigravity-cli 트랜스크립트"),
        ("cursor", "Cursor Agent CLI", "Cursor Pro", "~/.cursor 세션 로그"),
        ("opencode", "OpenCode CLI", "Local / API", "~/.opencode 세션 로그"),
    ] {
        if !cli_quotas.iter().any(|q| q.cli_id == extra_id) {
            let sum = cli_summaries.iter().find(|s| s.cli_id == extra_id);
            let r5h = sum.map(|s| s.rolling_5h_tokens).unwrap_or(0);
            let wk = sum.map(|s| s.weekly_tokens).unwrap_or(0);
            let pct_5h = ((r5h as f64 / 500_000.0) * 100.0).clamp(0.0, 100.0).round();
            let pct_wk = ((wk as f64 / 5_000_000.0) * 100.0).clamp(0.0, 100.0).round();
            cli_quotas.push(CliQuotaStatus {
                cli_id: extra_id.into(),
                cli_name: extra_name.into(),
                plan_label: extra_plan.into(),
                source_label: extra_source.into(),
                has_official_quota: false,
                used_percent_5h: pct_5h,
                remaining_percent_5h: (100.0 - pct_5h).clamp(0.0, 100.0),
                resets_at_5h: Some("롤링 5시간 윈도우".into()),
                used_percent_weekly: pct_wk,
                remaining_percent_weekly: (100.0 - pct_wk).clamp(0.0, 100.0),
                resets_at_weekly: Some("롤링 7일 윈도우".into()),
                status_message: None,
                sub_groups: None,
            });
        }
    }

    if let Ok(customs) = get_custom_clis(conn) {
        for c in customs {
            if !cli_quotas.iter().any(|q| q.cli_id == c.id) {
                let sum = cli_summaries.iter().find(|s| s.cli_id == c.id);
                let r5h = sum.map(|s| s.rolling_5h_tokens).unwrap_or(0);
                let wk = sum.map(|s| s.weekly_tokens).unwrap_or(0);
                let pct_5h = ((r5h as f64 / 500_000.0) * 100.0).clamp(0.0, 100.0).round();
                let pct_wk = ((wk as f64 / 5_000_000.0) * 100.0).clamp(0.0, 100.0).round();
                cli_quotas.push(CliQuotaStatus {
                    cli_id: c.id.clone(),
                    cli_name: c.name.clone(),
                    plan_label: c.provider.clone(),
                    source_label: "사용자 추가 CLI".into(),
                    has_official_quota: false,
                    used_percent_5h: pct_5h,
                    remaining_percent_5h: (100.0 - pct_5h).clamp(0.0, 100.0),
                    resets_at_5h: Some("롤링 5시간 윈도우".into()),
                    used_percent_weekly: pct_wk,
                    remaining_percent_weekly: (100.0 - pct_wk).clamp(0.0, 100.0),
                    resets_at_weekly: Some("롤링 7일 윈도우".into()),
                    status_message: None,
                    sub_groups: None,
                });
            }
        }
    }

    let active_quota = cli_filter
        .filter(|f| !f.is_empty() && *f != "all")
        .and_then(|f| cli_quotas.iter().find(|q| q.cli_id == f).cloned());

    Ok(UsageDashboardData {
        current_tokens,
        rolling_5h_tokens,
        rolling_5h_limit: 500_000,
        weekly_tokens,
        weekly_limit: 5_000_000,
        total_cost_usd: (total_cost_usd * 100.0).round() / 100.0,
        estimated_saved_tokens,
        daily_history,
        model_breakdown,
        cli_summaries,
        cli_quotas,
        active_quota,
        recent_logs_count,
        active_timeframe: Some(active_tf.to_string()),
    })
}

// --- 플러그인 / 스킬 / MCP 레지스트리 및 백업 ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryItem {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub is_token_saver: bool,
    pub is_builtin: bool,
    pub config_json: String,
    pub applied_clis: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: i64,
    pub cli_id: String,
    pub original_path: String,
    pub backup_path: String,
    pub created_at: String,
}

pub fn get_registry_items(conn: &Connection) -> Result<Vec<RegistryItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, name, description, enabled, is_token_saver, is_builtin, config_json, applied_clis_json, updated_at
         FROM registry_items
         ORDER BY is_token_saver DESC, kind ASC, name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let applied_raw: String = row.get(8)?;
        let applied_clis: Vec<String> = serde_json::from_str(&applied_raw).unwrap_or_default();
        Ok(RegistryItem {
            id: row.get(0)?,
            kind: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            enabled: row.get::<_, i64>(4)? != 0,
            is_token_saver: row.get::<_, i64>(5)? != 0,
            is_builtin: row.get::<_, i64>(6)? != 0,
            config_json: row.get(7)?,
            applied_clis,
            updated_at: row.get(9)?,
        })
    })?;

    Ok(rows.flatten().collect())
}

pub fn toggle_registry_item(conn: &Connection, item_id: &str, enabled: bool) -> Result<RegistryItem> {
    let now = Utc::now().to_rfc3339();
    let updated = conn.execute(
        "UPDATE registry_items SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
        params![if enabled { 1 } else { 0 }, now, item_id],
    )?;
    if updated == 0 {
        anyhow::bail!("레지스트리 항목을 찾을 수 없습니다: {}", item_id);
    }
    get_registry_items(conn)?
        .into_iter()
        .find(|i| i.id == item_id)
        .ok_or_else(|| anyhow::anyhow!("항목 조회 실패"))
}

pub fn upsert_registry_item(
    conn: &Connection,
    id: &str,
    kind: &str,
    name: &str,
    description: &str,
    config_json: &str,
    applied_clis: &[String],
) -> Result<RegistryItem> {
    let now = Utc::now().to_rfc3339();
    let applied_str = serde_json::to_string(applied_clis)?;
    conn.execute(
        "INSERT INTO registry_items
         (id, kind, name, description, enabled, is_token_saver, is_builtin, config_json, applied_clis_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, 0, 0, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            name = excluded.name,
            description = excluded.description,
            config_json = excluded.config_json,
            applied_clis_json = excluded.applied_clis_json,
            updated_at = excluded.updated_at",
        params![id, kind, name, description, config_json, applied_str, now],
    )?;

    get_registry_items(conn)?
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| anyhow::anyhow!("저장된 레지스트리 항목 조회 실패"))
}

pub fn record_backup(conn: &Connection, cli_id: &str, original_path: &str, backup_path: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO config_backups (cli_id, original_path, backup_path, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![cli_id, original_path, backup_path, now],
    )?;
    Ok(())
}

pub fn get_backups(conn: &Connection) -> Result<Vec<BackupRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, cli_id, original_path, backup_path, created_at
         FROM config_backups
         ORDER BY id DESC LIMIT 50",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(BackupRecord {
            id: row.get(0)?,
            cli_id: row.get(1)?,
            original_path: row.get(2)?,
            backup_path: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    Ok(rows.flatten().collect())
}

// --- 팀 모드 (Phase 8) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberRecord {
    pub member_id: String,
    pub member_name: String,
    pub role: String,
    pub department: String,
    pub favorite_cli: String,
    pub rolling_5h_tokens: u64,
    pub weekly_tokens: u64,
    pub saved_tokens_pct: f64,
    pub cost_usd: f64,
    pub headroom_active: bool,
    pub caveman_active: bool,
    pub synced_at: String,
}

pub fn get_team_members(conn: &Connection) -> Result<Vec<TeamMemberRecord>> {
    let mut stmt = conn.prepare(
        "SELECT member_id, member_name, role, department, favorite_cli, rolling_5h_tokens, weekly_tokens,
                saved_tokens_pct, cost_usd, headroom_active, caveman_active, synced_at
         FROM team_members
         ORDER BY weekly_tokens DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TeamMemberRecord {
            member_id: row.get(0)?,
            member_name: row.get(1)?,
            role: row.get(2)?,
            department: row.get(3)?,
            favorite_cli: row.get(4)?,
            rolling_5h_tokens: row.get::<_, i64>(5)? as u64,
            weekly_tokens: row.get::<_, i64>(6)? as u64,
            saved_tokens_pct: row.get(7)?,
            cost_usd: row.get(8)?,
            headroom_active: row.get::<_, i64>(9)? != 0,
            caveman_active: row.get::<_, i64>(10)? != 0,
            synced_at: row.get(11)?,
        })
    })?;
    Ok(rows.flatten().collect())
}

pub fn add_team_member(
    conn: &Connection,
    name: &str,
    role: &str,
    department: &str,
    favorite_cli: &str,
) -> Result<Vec<TeamMemberRecord>> {
    let now = Utc::now().to_rfc3339();
    let id = format!("member-{}", uuid::Uuid::new_v4());
    conn.execute(
        "INSERT INTO team_members
         (member_id, member_name, role, department, favorite_cli, rolling_5h_tokens, weekly_tokens, saved_tokens_pct, cost_usd, headroom_active, caveman_active, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 0.0, 0.0, 1, 1, ?6)",
        params![id, name, role, department, favorite_cli, now],
    )?;
    get_team_members(conn)
}

pub fn delete_team_member(conn: &Connection, member_id: &str) -> Result<Vec<TeamMemberRecord>> {
    conn.execute("DELETE FROM team_members WHERE member_id = ?1", params![member_id])?;
    get_team_members(conn)
}

/// 앱의 모든 사용자 데이터(등록 프로젝트, 사용량 통계, 팀원, 에이전트, API 키, 캐시)를 완전히 초기화(공장 초기화)
pub fn reset_all_user_data(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        DELETE FROM user_projects;
        DELETE FROM usage_logs;
        DELETE FROM team_members;
        DELETE FROM project_agents;
        DELETE FROM api_keys;
        DELETE FROM config_backups;
        VACUUM;
        ",
    )?;

    // 쿼터 캐시 파일 삭제
    let cache_path = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AI_CLI_Manager")
        .join("claude_quota_cache.json");
    if cache_path.exists() {
        let _ = std::fs::remove_file(cache_path);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        setup_schema(&conn).unwrap();
        seed_defaults(&conn).unwrap();
        conn
    }

    #[test]
    fn custom_cli_when_upserted_and_deleted_persists_accurately_in_sqlite() {
        let conn = create_memory_db();
        let input = CustomCliInput {
            id: "aider-cli".into(),
            name: "Aider Pair Programmer".into(),
            provider: "Aider".into(),
            binary_cmd: "aider.exe".into(),
            args: vec!["--dark-mode".into()],
            env_keys: vec!["ANTHROPIC_API_KEY".into()],
            login_command: "aider --help".into(),
            config_path: "".into(),
            skills_dir: "".into(),
            log_path: "".into(),
            accent_color: "#22d3ee".into(),
        };
        upsert_custom_cli(&conn, &input).unwrap();
        let list = get_custom_clis(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "aider-cli");
        assert!(list[0].is_custom);

        delete_custom_cli(&conn, "aider-cli").unwrap();
        assert!(get_custom_clis(&conn).unwrap().is_empty());
    }

    #[test]
    fn api_key_save_and_decrypt_when_valid_key_masks_preview_and_restores_exact_env() {
        let conn = create_memory_db();
        let status = save_api_key(&conn, "claude", "ANTHROPIC_API_KEY", "sk-ant-api03-secret9876").unwrap();
        assert!(status.has_key);
        assert_eq!(status.masked_preview.as_deref(), Some("sk-a••••9876"));

        let env_map = get_decrypted_env_for_cli(&conn, "claude").unwrap();
        assert_eq!(
            env_map.get("ANTHROPIC_API_KEY").map(|s| s.as_str()),
            Some("sk-ant-api03-secret9876")
        );
    }

    #[test]
    fn api_key_save_when_empty_whitespace_returns_validation_error() {
        let conn = create_memory_db();
        let res = save_api_key(&conn, "claude", "ANTHROPIC_API_KEY", "   ");
        assert!(res.is_err());
    }

    #[test]
    fn seed_defaults_when_initialized_enables_headroom_and_caveman_by_default() {
        let conn = create_memory_db();
        let items = get_registry_items(&conn).unwrap();
        let headroom = items.iter().find(|i| i.id == "headroom-mcp").expect("headroom must exist");
        let caveman = items.iter().find(|i| i.id == "caveman-skill").expect("caveman must exist");
        assert!(headroom.enabled);
        assert!(headroom.is_token_saver);
        assert!(caveman.enabled);
        assert!(caveman.is_token_saver);
    }

    #[test]
    fn usage_dashboard_when_records_inserted_calculates_rolling_5h_and_weekly_windows_accurately() {
        let conn = create_memory_db();
        let now = Utc::now();
        let records = vec![
            ParsedUsageRecord {
                event_hash: "ev1".into(),
                cli_id: "claude".into(),
                timestamp: (now - Duration::minutes(30)).to_rfc3339(),
                model_name: "claude-sonnet-4-20250514".into(),
                input_tokens: 1000,
                output_tokens: 500,
                cache_tokens: 500,
                cost_usd: 0.02,
            },
            ParsedUsageRecord {
                event_hash: "ev2".into(),
                cli_id: "codex".into(),
                timestamp: (now - Duration::hours(3)).to_rfc3339(),
                model_name: "gpt-5-codex".into(),
                input_tokens: 3000,
                output_tokens: 1000,
                cache_tokens: 0,
                cost_usd: 0.04,
            },
            ParsedUsageRecord {
                event_hash: "ev3".into(),
                cli_id: "claude".into(),
                timestamp: (now - Duration::days(3)).to_rfc3339(),
                model_name: "claude-sonnet-4-20250514".into(),
                input_tokens: 10000,
                output_tokens: 2000,
                cache_tokens: 0,
                cost_usd: 0.12,
            },
        ];

        let count = insert_usage_records(&conn, &records).unwrap();
        assert_eq!(count, 3);

        let dup_count = insert_usage_records(&conn, &records).unwrap();
        assert_eq!(dup_count, 0);

        let dash = get_usage_dashboard(&conn, None, None).unwrap();
        assert_eq!(dash.current_tokens, 2000);
        assert_eq!(dash.rolling_5h_tokens, 6000);
        assert_eq!(dash.weekly_tokens, 18000);
        assert_eq!(dash.model_breakdown.len(), 2);
    }

    #[test]
    fn project_agents_when_seeded_for_project_a_are_strictly_isolated_from_project_b() {
        let conn = create_memory_db();
        let temp_a = std::env::temp_dir().join(format!("acm_proj_a_{}", uuid::Uuid::new_v4()));
        let temp_b = std::env::temp_dir().join(format!("acm_proj_b_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_a).unwrap();
        std::fs::create_dir_all(&temp_b).unwrap();

        let path_a = temp_a.to_string_lossy().to_string();
        let path_b = temp_b.to_string_lossy().to_string();

        let agents_a = seed_project_agents_preset(&conn, &path_a).unwrap();
        assert_eq!(agents_a.len(), 4);
        assert!(temp_a.join(".ai-agents").join("BLACKBOARD.md").exists());

        let agents_b = get_project_agents(&conn, &path_b).unwrap();
        assert!(agents_b.is_empty());

        let _ = std::fs::remove_dir_all(&temp_a);
        let _ = std::fs::remove_dir_all(&temp_b);
    }

    #[test]
    fn analyze_project_workspace_when_files_exist_detects_stack_and_recommends_tailored_agents() {
        let temp_proj = std::env::temp_dir().join(format!("acm_analyze_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_proj).unwrap();
        std::fs::write(
            temp_proj.join("package.json"),
            r#"{"dependencies": {"react": "^18.0.0", "tailwindcss": "^3.4.0"}}"#,
        )
        .unwrap();
        std::fs::write(temp_proj.join("requirements.txt"), "fastapi\n").unwrap();

        let analysis = analyze_project_workspace(&temp_proj.to_string_lossy()).unwrap();
        assert!(analysis.detected_stacks.iter().any(|s| s.contains("React")));
        assert!(analysis.detected_stacks.iter().any(|s| s.contains("Python")));
        assert_eq!(analysis.recommended_agents.len(), 5);

        let _ = std::fs::remove_dir_all(&temp_proj);
    }
}
