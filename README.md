# AgentriX

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-0078d4?style=for-the-badge&logo=windows&logoColor=white" />
  <img src="https://img.shields.io/badge/Rust-Tauri%20v2-orange?style=for-the-badge&logo=rust&logoColor=white" />
  <img src="https://img.shields.io/badge/Frontend-React%2018%20%2B%20TypeScript%20%2B%20Tailwind-61dafb?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge" />
</p>

<p align="center">
  <b>Windows Multi-AI Coding CLI Workspace & Real-Time Quota/Token Hub</b><br />
  Run Claude Code, Antigravity (agy), Codex CLI, and Grok CLI side-by-side in a high-performance split terminal while monitoring rolling token limits, reset schedules, and managing lossless session handoffs.
</p>

<p align="center">
  <a href="#english">English</a> | <a href="#한국어">한국어</a>
</p>

---

<a name="english"></a>
## 🌐 English

### ✨ Key Features

#### 1. ⏱️ Real-Time Subscription Quota & 0ms Reset Monitoring
- **Claude Code**: Live Anthropic OAuth integration (5-hour rolling session limit, weekly limits, and auto-formatted reset countdowns).
- **Antigravity (`agy`)**: Google DeepMind Antigravity quota tracking by model family (Claude/GPT tiers and Gemini Argon).
- **Codex CLI & Grok CLI**: Automated session usage and xAI official billing balance tracking.
- **0ms Instant Cache**: Persistent disk cache restores previous usage data immediately on launch with zero delay.

#### 2. 🖥️ Professional Multi-Terminal Split Workspace
- **4 Flexible Layouts**: Single Fullscreen / Side-by-Side (2 splits) / Top-Bottom (2 splits) / 2x2 Grid (4 splits).
- **Fixed Slot Stability**: Terminal panes maintain strictly fixed positions without layout shifting or focus scrambling.
- **`Ctrl + Mouse Wheel` Zoom**: Hooked canvas rendering for real-time font scaling and instant one-click reset.
- **Keyboard Shortcuts**:
  - `Alt + 1` ~ `Alt + 4`: Instant focus switch to terminal pane 1–4.
  - `Alt + S`: Cycle through layout modes.
  - `Ctrl + 0`: Reset terminal font size to default (13.5px).
  - `F11`: Toggle window fullscreen.

#### 3. 👥 Project AI Agent Teams & 🤖 AI Deep Team Builder
- **Zero-Cost Static Analysis**: Instant project scan (`package.json`, `Cargo.toml`, `pyproject.toml`, etc.) to suggest default developer roles.
- **AI Deep Team Builder**: Connect your choice of LLM (Claude, GPT-4o, Gemini, Groq, Ollama) to deeply inspect the codebase and automatically design 3–5 specialized agent personas and system prompts.
- **Persistent Roster**: Agent team configurations are permanently stored in local SQLite database.
- **One-Click Team Summon (`🚀 Summon All Agents`)**: Instantly launch all assigned team member sessions at once.
- **Task Board Panel**: Header button opens a 4-column kanban (pending / in progress / done / rejected) of `.ai-agents/BLACKBOARD.md`, with manual approval and the latest 5 done cards.
- **Busy Indicator**: Terminals that are producing output glow in their CLI color with a "working" spinner in the pane header (static border with reduced motion).

#### 4. ⚡ Token Optimization & Smart Auto-Handoff Relay
- **Two-Stage Context Guard**: Automatically attempts `/compact` compression first; triggers seamless session relay if usage remains critical.
- **Lossless Markdown Handover (`SESSION_HANDOFF.md`)**:
  - Generates comprehensive summaries, active agent personas, and task roadmaps into `.ai-agents/SESSION_HANDOFF.md`.
  - Automatically loads handoff context into newly spawned sessions so workflows continue without interruption.
- **Resource Protection**: Old PTY processes are cleanly terminated and freed from RAM immediately after handoff to avoid memory leaks.
- **Manual Relay**: Single-click `[Relay]` button on any terminal header for instant on-demand session handoff.

#### 5. 🛡️ System Tray Background Guard
- Confirmation dialog on window close (`X`) prevents accidental session termination by minimizing to System Tray.
- Context menu options: `Open AgentriX`, `Refresh Quotas`, `Exit Completely`.
- Windows 11 Dark/Light mode synchronization across all UI components and native folder pickers.

---

### ⌨️ Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| **`Alt + 1` ~ `Alt + 4`** | Jump focus to Terminal 1 ~ 4 |
| **`Alt + S`** | Cycle split layout (Single ↔ Side-by-Side ↔ Stacked ↔ 2x2 Grid) |
| **`Ctrl + Mouse Wheel`** | Real-time terminal font zoom in / out |
| **`Ctrl + 0`** | Reset terminal font size to default (13.5px) |
| **`Ctrl + +` / `Ctrl + -`** | Stepwise font size adjustment (±1px) |
| **`F11`** | Toggle Fullscreen |

---

### 🛠️ Quick Start

#### Download Portable Binary (No Installation Required)
1. Download `AgentriX.exe` (portable) or `AgentriX-Setup-v1.0.3.exe` (installer) from [GitHub Releases](https://github.com/TodookGamja/AgentriX/releases).
2. Place `AgentriX.exe` in any folder and double-click to run. Later versions update in-app (signature verified).

#### Build from Source
```bash
# Clone the repository
git clone https://github.com/TodookGamja/AgentriX.git
cd AgentriX

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Package standalone release binary
build_release.bat
```

---

<a name="한국어"></a>
## 🇰🇷 한국어

### ✨ 핵심 기능

#### 1. ⏱️ 4대 AI CLI 실시간 구독 쿼터 & 0ms 리셋 모니터링
- **Claude Code**: Anthropic OAuth 실시간 연동 (5시간 롤링 세션 잔여율, 주간 한도, 리셋 시각 KST 자동 포맷)
- **Antigravity (`agy`)**: Google DeepMind Antigravity 모델별 쿼터 연동 (Claude/GPT 모델군, Gemini Argon 분리 표시)
- **Codex CLI & Grok CLI**: 세션 사용량 및 xAI 공식 Billing 크레딧 잔여율 자동 추적
- **0ms 즉각 렌더링**: 로컬 디스크 영구 캐시 엔진으로 앱 시작 첫 프레임부터 딜레이 없이 직전 쿼터 즉시 복원

#### 2. 🖥️ 프로급 멀티 터미널 분할 환경 (Multi-Terminal Split)
- **4가지 레이아웃**: 단일 전체화면 / 좌우 2분할 (Side-by-Side) / 위아래 2분할 / 4군데 격자 4분할 (2x2 Grid)
- **화면 위치 불변 보장**: 포커스 이동 시 슬롯 간 화면이 섞이거나 이동하지 않고 그 자리에 고정
- **`Ctrl + 마우스 휠` 줌 & 폰트 컨트롤**: xterm.js 캔버스 캡처링 단계 후킹으로 실시간 폰트 확대/축소 및 원클릭 리셋 지원
- **단축키**:
  - `Alt + 1` ~ `Alt + 4`: 분할 화면 1~4번 터미널로 즉시 키보드 포커스 이동
  - `Alt + S`: 터미널 분할 레이아웃 순환 전환
  - `Ctrl + 0`: 폰트 크기 기본값(13.5px) 원상 복구
  - `F11`: 전체화면 토글

#### 3. 👥 프로젝트별 AI 에이전트 팀 & 🤖 AI 심층 팀빌딩 (AI Deep Team Builder)
- **로컬 정적 분석 (비용 0원)**: `package.json`, `Cargo.toml`, `pyproject.toml` 등을 0초 만에 스캔하여 기본 개발팀 자동 추천
- **✨ AI 심층 팀빌딩 (사용자 AI 엔진 연동)**:
  - 사용자가 원하는 AI(Anthropic Claude, OpenAI GPT-4o, Google Gemini, Groq, Ollama)를 연결하여 프로젝트 코드베이스 전체를 심층 분석
  - 도메인과 비즈니스 로직에 특화된 3~5인의 고도화된 전문 에이전트 팀 및 역할 프롬프트 자동 기획
  - API 연결 테스트, 모델 선택, 원클릭 일괄 적용 지원
- **영구 보존**: 직접 [삭제]를 누르지 않는 한 앱을 껐다 켜도 편성된 에이전트 팀이 SQLite DB에 영구 유지
- **원클릭 일괄 출근 (`🚀 팀 전원 일괄 출근`)**: 앱 재실행 후 버튼 하나로 편성된 모든 에이전트 세션 동시 복원
- **작업보드 패널**: 헤더 버튼으로 `.ai-agents/BLACKBOARD.md`를 4열 칸반(승인 대기/진행 중/완료/반려)으로 확인, 수동 승인과 최근 완료 5개 표시
- **작업 중 표시**: 출력 중인 터미널은 CLI 색 테두리가 맥동하고 칸 헤더에 "작업 중" 스피너 표시 (동작 줄이기 설정 시 정적 테두리)

#### 4. ⚡ 토큰 최적화 & 스마트 자동 세션 릴레이 (Auto-Handoff Relay)
- **컴팩트 1회 후에도 가득일 때 자동 릴레이**: 임계치 도달 시 1차 `/compact` 압축을 자동 시도하며, 압축 후에도 토큰이 초과되면 새 세션으로 연계
- **Markdown 파일 기반 무손실 인수인계 (`SESSION_HANDOFF.md`)**:
  - 직전 세션 작업 로그 요약, 담당 에이전트 역할, 후속 작업 지침을 `.ai-agents/SESSION_HANDOFF.md` 및 `BLACKBOARD.md`에 실시간 파일 기록
  - 신규 세션 기동 시 인수인계 마크다운 파일을 자동으로 읽고 중단점부터 즉시 연속 작업 수행하도록 프롬프트 자동 주입
- **PC 자원/메모리 과부하 원천 차단 (구 세션 프로세스 즉시 종료)**:
  - 인수인계 완료 즉시 직전 세션의 PTY 프로세스를 안전하게 종료(`apiStopSession`) 및 메모리에서 해제하여 세션 누적으로 인한 PC 버벅임 방지
- **원클릭 수동 릴레이**: 터미널 상단 `[릴레이]` 버튼 클릭으로 원할 때 언제든 즉시 다음 세션으로 안전 인수인계 및 구 세션 정리 가능

#### 5. 🛡️ 시스템 트레이(System Tray) 백그라운드 상주 & 세션 보호
- 창 닫기(`X`) 클릭 시 작업 중인 터미널이 있으면 **[트레이로 숨기기]** 확인 모달로 세션 유실 방지
- 트레이 우클릭 컨텍스트 메뉴 (`AgentriX 열기`, `한도 현황 새로고침`, `완전 종료`)
- 윈도우 11 다크 / 라이트 테마 완벽 동기화 (폴더 탐색 다이얼로그 테마 연동)

---

### ⌨️ 단축키 안내

| 단축키 | 동작 |
| :--- | :--- |
| **`Alt + 1` ~ `Alt + 4`** | 분할 터미널 1번 ~ 4번으로 즉시 키보드 포커스 이동 |
| **`Alt + S`** | 분할 레이아웃 순환 (단일 ↔ 좌우 ↔ 상하 ↔ 4분할) |
| **`Ctrl + 마우스 휠`** | 터미널 글자 크기 실시간 확대 / 축소 |
| **`Ctrl + 0`** | 터미널 글자 크기 기본값(13.5px)으로 원상 복구 |
| **`Ctrl + +` / `Ctrl + -`** | 터미널 글자 크기 1px 단위 확대 / 축소 |
| **`F11`** | 창 최대화 / 이전 크기 복원 토글 |

---

### 🛠️ 빠른 시작

#### 포터블 바이너리 실행 (무설치)
1. [Releases](https://github.com/TodookGamja/AgentriX/releases) 탭에서 `AgentriX.exe`(무설치) 또는 `AgentriX-Setup-v1.0.3.exe`(설치형) 다운로드
2. `AgentriX.exe`는 원하는 폴더에 넣고 바로 더블클릭하여 실행. 이후 버전은 앱 안에서 업데이트(서명 검증)

#### 소스코드 빌드
```bash
# 저장소 클론
git clone https://github.com/TodookGamja/AgentriX.git
cd AgentriX

# 프론트엔드 의존성 설치
npm install

# 개발 모드 실행
npm run tauri dev

# 릴리즈 단일 바이너리 빌드
build_release.bat
```

---

## 📄 라이선스 (License)

이 프로젝트는 [MIT License](LICENSE)에 따라 자유롭게 사용, 수정, 배포할 수 있습니다.
This project is licensed under the [MIT License](LICENSE).
