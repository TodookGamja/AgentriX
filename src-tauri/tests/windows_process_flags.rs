use std::path::Path;

fn check_directory(dir: &Path) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            check_directory(&path);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            let source = std::fs::read_to_string(&path).unwrap();
            assert!(!source.contains("use std::process::Command;"), "{}: scan qualified Command constructors", path.display());
            let lines: Vec<_> = source.lines().collect();
            for (index, line) in lines.iter().enumerate().filter(|(_, line)| line.contains("std::process::Command::new(")) {
                // These constructors are compiled only on non-Windows platforms.
                if line.contains("Command::new(\"open\")") || line.contains("Command::new(\"xdg-open\")")
                    || (index > 0 && lines[index - 1].trim() == "#[cfg(not(windows))]")
                    || (line.contains("Command::new(&current_exe)") && line.contains(".spawn()")) {
                    continue;
                }
                let variable = line.split("let mut ").nth(1).and_then(|s| s.split_whitespace().next());
                let flag = variable.map(|name| format!("{name}.creation_flags(")).unwrap_or_else(|| ".creation_flags(".to_string());
                let valid = |next: &&str| next.contains(&flag) && (next.contains("0x08000000") || (next.contains("0x00000200") && next.contains("0x00000008")));
                let found = lines[index..].iter().take(40).take_while(|next| !next.contains(".output()") && !next.contains(".spawn()") && !next.contains(".status()")).any(valid)
                    || valid(&line);
                assert!(found, "{}:{}: Windows process missing creation flags", path.display(), index + 1);
            }
        }
    }
}

#[test]
fn windows_commands_set_creation_flags() {
    check_directory(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"));
}
