@echo off
chcp 65001 > nul
echo =======================================================
echo       AgentriX Release Packaging (Portable & Installer)
echo =======================================================
echo.

set RELEASE_DIR=release
if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"

set VERSION=1.1.8

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

echo.
echo [2-1] 포터블 ZIP 압축 생성 중... (AgentriX-Portable-v%VERSION%-win-x64.zip)
powershell -NoProfile -Command "Compress-Archive -Path '%RELEASE_DIR%\AgentriX.exe', 'README.md', 'LICENSE' -DestinationPath '%RELEASE_DIR%\AgentriX-Portable-v%VERSION%-win-x64.zip' -Force"

echo.
echo [3/3] NSIS 설치형 인스톨러(Setup.exe) 패키징 중...
call npx tauri build
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Tauri bundle installer 생성 중 경고가 발생했습니다.
) else (
    copy /y "target\release\bundle\nsis\AgentriX_%VERSION%_x64-setup.exe" "%RELEASE_DIR%\AgentriX-Setup-v%VERSION%.exe" > nul
)

echo.
echo =======================================================
echo [완료] release 폴더에 v%VERSION% 배포 패키지가 준비되었습니다!
echo  - 포터블 단일 실행파일: %RELEASE_DIR%\AgentriX.exe
echo  - 포터블 압축 파일:     %RELEASE_DIR%\AgentriX-Portable-v%VERSION%-win-x64.zip
echo  - 설치형 인스톨러:       %RELEASE_DIR%\AgentriX-Setup-v%VERSION%.exe
dir "%RELEASE_DIR%"
echo =======================================================
