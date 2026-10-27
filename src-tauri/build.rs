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

    let attrs = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().window_icon_path("icons/icon.ico")
    );
    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
