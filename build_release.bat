@echo off
chcp 65001 > nul
echo =======================================================
echo       AgentriX Release Packaging (Portable ^& Installer)
echo =======================================================
echo.

set RELEASE_DIR=release
set "SIGNING_KEY=%USERPROFILE%\.agentrix\agentrix.key"
if not exist "%SIGNING_KEY%" (
    echo [ERROR] Signing key missing: %SIGNING_KEY%
    echo Run: npx tauri signer generate -w "%SIGNING_KEY%"
    exit /b 1
)
if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VERSION=%%v"
if not defined VERSION exit /b 1
for %%F in ("%RELEASE_DIR%\AgentriX-Portable-v*-win-x64.zip") do if exist "%%~fF" del "%%~fF" || exit /b 1
for %%F in ("%RELEASE_DIR%\AgentriX-Setup-v*.exe") do if exist "%%~fF" if /I not "%%~nxF"=="AgentriX-Setup-v%VERSION%.exe" del "%%~fF" || exit /b 1
for %%F in ("target\release\bundle\nsis\AgentriX_*_x64-setup.exe") do if exist "%%~fF" if /I not "%%~nxF"=="AgentriX_%VERSION%_x64-setup.exe" del "%%~fF" || exit /b 1

echo [1/3] 프론트엔드 프로덕션 빌드 중... (v%VERSION%)
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 프론트엔드 빌드 실패!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] 무설치 포터블(Portable) 바이너리 빌드 중...
cargo build --release --manifest-path src-tauri/Cargo.toml
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Cargo 빌드 실패!
    pause
    exit /b %ERRORLEVEL%
)

copy /y target\release\ai-cli-manager.exe AgentriX.exe > nul
copy /y target\release\ai-cli-manager.exe "%RELEASE_DIR%\AgentriX.exe" > nul
if errorlevel 1 exit /b 1
if exist "%RELEASE_DIR%\AgentriX.exe.sig" del "%RELEASE_DIR%\AgentriX.exe.sig"
call npx tauri signer sign --private-key-path "%SIGNING_KEY%" "%RELEASE_DIR%\AgentriX.exe"
if errorlevel 1 exit /b 1
cargo test --manifest-path src-tauri/Cargo.toml --release verify_release_artifact -- --ignored
if errorlevel 1 exit /b 1

echo.
echo [3/3] NSIS 설치형 인스톨러(Setup.exe) 패키징 중...
if exist "%RELEASE_DIR%\AgentriX-Setup-v%VERSION%.exe" del "%RELEASE_DIR%\AgentriX-Setup-v%VERSION%.exe"
call npx tauri build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Tauri bundle installer 빌드 실패!
    exit /b 1
)
copy /y "target\release\bundle\nsis\AgentriX_%VERSION%_x64-setup.exe" "%RELEASE_DIR%\AgentriX-Setup-v%VERSION%.exe" > nul
if errorlevel 1 exit /b 1

echo.
echo =======================================================
echo [완료] release 폴더에 v%VERSION% 배포 패키지가 준비되었습니다!
echo  - 포터블 단일 실행파일: %RELEASE_DIR%\AgentriX.exe
echo  - 업데이트 서명:         %RELEASE_DIR%\AgentriX.exe.sig
echo  - 설치형 인스톨러:       %RELEASE_DIR%\AgentriX-Setup-v%VERSION%.exe
dir "%RELEASE_DIR%"
echo =======================================================
