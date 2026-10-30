use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct Mail {
    pub to: String,
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxMessage {
    pub id: String,
    pub from: String,
    pub to: String,
    pub subject: String,
    pub body: String,
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 512 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn sender_prefix(id: &str) -> String {
    id.bytes().map(|b| format!("{b:02x}")).collect::<String>() + "_"
}

fn agent_dir(project: &Path, id: &str) -> Result<PathBuf, String> {
    if !safe_id(id) || id.len() > 160 { return Err("Invalid agent ID".into()); }
    Ok(project.join(".ai-agents").join("agents").join(id))
}

/// 수신자 표기(ID 또는 팀원 이름)를 팀원 ID로 변환. 이름은 대소문자/공백 무시, 중복 이름이면 모호하므로 거부
fn resolve_recipient(to: &str, agents: &[(String, String)]) -> Option<String> {
    if let Some((id, _)) = agents.iter().find(|(id, _)| id == to) { return Some(id.clone()); }
    let key = to.trim().to_lowercase();
    if key.is_empty() { return None; }
    let mut hit = agents.iter().filter(|(_, name)| name.trim().to_lowercase() == key);
    match (hit.next(), hit.next()) { (Some((id, _)), None) => Some(id.clone()), _ => None }
}

/// agents: (ID, 이름). 메시지의 `to`에는 ID 또는 이름을 쓸 수 있음
pub fn route(project: &Path, roster: &[(String, String)]) -> Result<Vec<InboxMessage>, String> {
    let agents: Vec<String> = roster.iter().map(|(id, _)| id.clone()).collect();
    let agents = &agents[..];
    for from in agents {
        let dir = agent_dir(project, from)?;
        let outbox = dir.join("outbox");
        fs::create_dir_all(&outbox).map_err(|e| e.to_string())?;
        fs::create_dir_all(dir.join("inbox")).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(&outbox).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() { continue; }
            let Some(name) = path.file_stem().and_then(|v| v.to_str()) else { continue };
            if path.extension().and_then(|v| v.to_str()) != Some("json") || !safe_id(name) { continue; }
            if entry.metadata().map_err(|e| e.to_string())?.len() > 65536 { continue; }
            let Ok(mut mail) = serde_json::from_slice::<Mail>(&fs::read(&path).map_err(|e| e.to_string())?) else { continue };
            let Some(to_id) = resolve_recipient(&mail.to, roster) else { continue };
            if to_id == *from || mail.body.trim().is_empty() { continue; }
            mail.to = to_id;
            let inbox = agent_dir(project, &mail.to)?.join("inbox");
            fs::create_dir_all(&inbox).map_err(|e| e.to_string())?;
            let message_name = format!("{}{name}.json", sender_prefix(from));
            if message_name.len() > 240 { continue; }
            let target = inbox.join(&message_name);
            if target.exists() || inbox.join("done").join(&message_name).exists() { continue; }
            // 이름으로 보낸 경우에도 수신함에는 ID로 정규화해서 저장
            fs::write(&target, serde_json::to_vec(&mail).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    let mut messages = Vec::new();
    for to in agents {
        let inbox = agent_dir(project, to)?.join("inbox");
        for entry in fs::read_dir(inbox).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() { continue; }
            let Some(id) = path.file_stem().and_then(|v| v.to_str()) else { continue };
            let Some(from) = agents.iter().find(|a| id.starts_with(&sender_prefix(a))) else { continue };
            if !safe_id(id) { continue; }
            if entry.metadata().map_err(|e| e.to_string())?.len() > 65536 { continue; }
            let Ok(mail) = serde_json::from_slice::<Mail>(&fs::read(&path).map_err(|e| e.to_string())?) else { continue };
            if mail.to != *to { continue; }
            messages.push(InboxMessage { id: id.into(), from: from.clone(), to: to.clone(), subject: mail.subject, body: mail.body });
        }
    }
    messages.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_once_and_keeps_invalid_messages() {
        let project = std::env::temp_dir().join(format!("agentrix-mail-{}", uuid::Uuid::new_v4()));
        let agents = vec![("a".to_string(), "Mira".to_string()), ("b".to_string(), "Jun".to_string())];
        route(&project, &agents).unwrap();
        let outbox = agent_dir(&project, "a").unwrap().join("outbox");
        fs::write(outbox.join("one.json"), r#"{"to":" jun ","subject":"hello","body":"work"}"#).unwrap();
        fs::write(outbox.join("bad.json"), r#"{"to":"../bad","subject":"x","body":"work"}"#).unwrap();
        let inbox = route(&project, &agents).unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].from, "a");
        assert_eq!(route(&project, &agents).unwrap().len(), 1);
        assert!(outbox.join("bad.json").exists());
        acknowledge(&project, "b", &inbox[0].id).unwrap();
        assert!(route(&project, &agents).unwrap().is_empty());
        fs::write(outbox.join("one.json"), r#"{"to":"b","subject":"hello","body":"work"}"#).unwrap();
        assert!(route(&project, &agents).unwrap().is_empty());
        assert!(acknowledge(&project, "b", "../bad").is_err());
        fs::remove_dir_all(project).unwrap();
    }
}

pub fn acknowledge(project: &Path, agent: &str, id: &str) -> Result<(), String> {
    if !safe_id(id) { return Err("Invalid message ID".into()); }
    let inbox = agent_dir(project, agent)?.join("inbox");
    let done = inbox.join("done");
    fs::create_dir_all(&done).map_err(|e| e.to_string())?;
    fs::rename(inbox.join(format!("{id}.json")), done.join(format!("{id}.json"))).map_err(|e| e.to_string())
}
