use std::path::{Path, PathBuf};

/// 핸드오프 문서에 기록되는 민감 정보(API 키, Bearer 토큰 등)를 디스크 저장 전 안전하게 마스킹 (ADR-3)
pub fn redact_secrets(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut i = 0;
    let bytes = input.as_bytes();
    let len = bytes.len();

    while i < len {
        let is_word_boundary = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();

        if is_word_boundary {
            // Bearer 토큰 마스킹
            if input[i..].starts_with("Bearer ") {
                result.push_str("Bearer ***");
                i += "Bearer ".len();
                while i < len
                    && !bytes[i].is_ascii_whitespace()
                    && bytes[i] != b'"'
                    && bytes[i] != b'\''
                    && bytes[i] != b'`'
                    && bytes[i] != b','
                    && bytes[i] != b';'
                {
                    i += 1;
                }
                continue;
            }

            // sk-, xai-, ghp_, AKIA 접두사 마스킹
            let prefixes = [
                ("sk-", "sk-***"),
                ("xai-", "xai-***"),
                ("ghp_", "ghp_***"),
                ("AKIA", "AKIA***"),
            ];

            let mut matched = false;
            for (prefix, replacement) in prefixes {
                if input[i..].starts_with(prefix) {
                    let start = i + prefix.len();
                    let mut end = start;
                    while end < len
                        && (bytes[end].is_ascii_alphanumeric()
                            || bytes[end] == b'-'
                            || bytes[end] == b'_'
                            || bytes[end] == b'.')
                    {
                        end += 1;
                    }
                    if end - start >= 3 {
                        result.push_str(replacement);
                        i = end;
                        matched = true;
                        break;
                    }
                }
            }

            if matched {
                continue;
            }
        }

        if let Some(c) = input[i..].chars().next() {
            result.push(c);
            i += c.len_utf8();
        } else {
            break;
        }
    }

    result
}

/// 프로젝트 경로 및 파일명의 경로 트래버설, 시스템 디렉터리 접근을 검증하고 안전한 저장 경로를 반환 (ADR-2)
pub fn validate_safe_handoff_path(
    project_path: &str,
    filename: Option<&str>,
) -> Result<PathBuf, String> {
    let norm = crate::db::normalize_project_path(project_path);
    if norm.is_empty() || crate::db::is_forbidden_system_dir(&norm) {
        return Err("금지된 시스템 디렉터리이거나 유효하지 않은 프로젝트 경로입니다.".into());
    }

    let fname = filename.unwrap_or("SESSION_HANDOFF.md").trim();
    if fname.is_empty() {
        return Err("인수인계 파일명이 비어있습니다.".into());
    }

    // Path traversal 및 위험 문자 방어: '..', 디렉터리 구분자, 콜론(ADS), 금지 특수문자 금지
    if fname.contains("..")
        || fname
            .chars()
            .any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'))
    {
        return Err("파일명에 허용되지 않는 경로 구분자나 위험 기호가 포함되어 있습니다.".into());
    }

    // Windows 장치 예약어 방어 (CON, PRN, AUX, NUL, COM1-9, LPT1-9 등)
    let stem = fname.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL"
            | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9"
            | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    ) {
        return Err("Windows 장치 예약어 파일명은 사용할 수 없습니다.".into());
    }

    // 안전한 .ai-agents 하위 디렉터리 구성
    let target_dir = Path::new(&norm).join(".ai-agents");
    Ok(target_dir.join(fname))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_secrets_masks_sensitive_tokens_accurately() {
        // T2 완료 기준: sk-ant-xxx 가 sk-*** 로 바뀜
        let sample = "Anthropic key: sk-ant-api03-abcdef123456789\n\
                      OpenAI key: sk-proj-1234567890abcdef\n\
                      xAI key: xai-998877665544\n\
                      Header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9; end\n\
                      GitHub token: ghp_16C7e42F292c6912E7710c838347Ae178B4a\n\
                      AWS key: AKIAIOSFODNN7EXAMPLE\n\
                      Normal text: task-scheduler should remain intact.";

        let redacted = redact_secrets(sample);

        assert!(redacted.contains("Anthropic key: sk-***"));
        assert!(redacted.contains("OpenAI key: sk-***"));
        assert!(redacted.contains("xAI key: xai-***"));
        assert!(redacted.contains("Header: Bearer ***; end"));
        assert!(redacted.contains("GitHub token: ghp_***"));
        assert!(redacted.contains("AWS key: AKIA***"));
        assert!(redacted.contains("task-scheduler should remain intact."));
    }

    #[test]
    fn validate_safe_handoff_path_blocks_system_dirs_and_traversal() {
        // 시스템 경로 거부
        assert!(validate_safe_handoff_path("C:\\Windows\\System32", None).is_err());
        assert!(validate_safe_handoff_path("C:\\Program Files", None).is_err());
        assert!(validate_safe_handoff_path("C:\\Program Files (x86)", None).is_err());
        assert!(validate_safe_handoff_path("C:\\", None).is_err());
        assert!(validate_safe_handoff_path("D:\\Windows", None).is_err());
        assert!(validate_safe_handoff_path("", None).is_err());

        // Path Traversal 및 위험 문자 거부
        let temp = std::env::temp_dir();
        let valid_proj = temp.to_string_lossy().to_string();
        assert!(validate_safe_handoff_path(&valid_proj, Some("../malicious.exe")).is_err());
        assert!(validate_safe_handoff_path(&valid_proj, Some("sub/evil.md")).is_err());
        assert!(validate_safe_handoff_path(&valid_proj, Some("sub\\evil.md")).is_err());
        assert!(validate_safe_handoff_path(&valid_proj, Some("evil:ads.txt")).is_err());
        assert!(validate_safe_handoff_path(&valid_proj, Some("con.txt")).is_err());
        assert!(validate_safe_handoff_path(&valid_proj, Some("aux.md")).is_err());
        assert!(validate_safe_handoff_path(&valid_proj, Some("nul")).is_err());
        assert!(validate_safe_handoff_path(&valid_proj, Some("")).is_err());

        // 정상 경로
        let safe_path = validate_safe_handoff_path(&valid_proj, Some("CUSTOM_HANDOFF.md")).expect("valid path");
        assert!(safe_path.ends_with(".ai-agents\\CUSTOM_HANDOFF.md") || safe_path.ends_with(".ai-agents/CUSTOM_HANDOFF.md"));
    }
}
