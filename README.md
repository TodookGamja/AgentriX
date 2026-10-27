# AgentriX (에이전트릭스)

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-0078d4?style=for-the-badge&logo=windows&logoColor=white" />
  <img src="https://img.shields.io/badge/Rust-Tauri%20v2-orange?style=for-the-badge&logo=rust&logoColor=white" />
  <img src="https://img.shields.io/badge/Frontend-React%2018%20%2B%20TypeScript%20%2B%20Tailwind-61dafb?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge" />
</p>

<p align="center">
  <b>Windows Multi-AI Coding CLI Workspace & Real-Time Token/Quota Hub</b><br />
  클로드 코드(Claude Code), 안티그래비티(Antigravity agy), 코덱스(Codex CLI), 그록(Grok CLI)을 한 화면에서 분할 실행하고, 5시간 및 주간 토큰 쿼터/리셋 일정을 실시간으로 모니터링하는 전문 올인원 데스크톱 환경입니다.
</p>

---

## ✨ 핵심 기능 (Key Features)

### 1. ⏱️ 4대 AI CLI 실시간 구독 쿼터 & 0ms 리셋 모니터링
- **Claude Code**: Anthropic OAuth 실시간 연동 (5시간 롤링 세션 잔여율, 주간 한도, 리셋 시각 KST 자동 포맷)
- **Antigravity (`agy`)**: Google DeepMind Antigravity 모델별 쿼터 연동 (Claude/GPT 모델군, Gemini Argon 분리 표시)
- **Codex CLI & Grok CLI**: 세션 사용량 및 xAI 공식 Billing 크레딧 잔여율 자동 추적
- **0ms 즉각 렌더링**: 로컬 디스크 영구 캐시 엔진으로 앱 시작 첫 프레임부터 딜레이 없이 직전 쿼터 즉시 복원

### 2. 🖥️ 프로급 멀티 터미널 분할 환경 (Multi-Terminal Split)
- **4가지 레이아웃**: 단일 전체화면 / 좌우 2분할 (Side-by-Side) / 위아래 2분할 / 4군데 격자 4분할 (2x2 Grid)
- **화면 위치 불변 보장**: 포커스 이동 시 슬롯 간 화면이 섞이거나 이동하지 않고 그 자리에 고정
- **`Ctrl + 마우스 휠` 줌 & 폰트 컨트롤**: xterm.js 캔버스 캡처링 단계 후킹으로 실시간 폰트 확대/축소 및 원클릭 리셋 지원
- **단축키**:
  - `Alt + 1` ~ `Alt + 4`: 분할 화면 1~4번 터미널로 즉시 키보드 포커스 이동
  - `Alt + S`: 터미널 분할 레이아웃 순환 전환
  - `Ctrl + 0`: 폰트 크기 기본값(13.5px) 원상 복구
  - `F11`: 전체화면 토글

### 3. 👥 프로젝트별 AI 에이전트 팀 & 🤖 AI 심층 팀빌딩 (AI Deep Team Builder)
- **로컬 정적 분석 (비용 0원)**: `package.json`, `Cargo.toml`, `pyproject.toml` 등을 0초 만에 스캔하여 기본 개발팀 자동 추천
- **✨ AI 심층 팀빌딩 (사용자 AI 엔진 연동)**:
  - 사용자가 원하는 AI(Anthropic Claude, OpenAI GPT-4o, Google Gemini, Groq, Ollama)를 연결하여 프로젝트 코드베이스 전체를 심층 분석
  - 도메인과 비즈니스 로직에 특화된 3~5인의 고도화된 전문 에이전트 팀 및 역할 프롬프트 자동 기획
  - API 연결 테스트, 모델 선택, 원클릭 일괄 적용 지원
- **영구 보존**: 직접 [삭제]를 누르지 않는 한 앱을 껐다 켜도 편성된 에이전트 팀이 SQLite DB에 영구 유지
- **원클릭 일괄 출근 (`🚀 팀 전원 일괄 출근`)**: 앱 재실행 후 버튼 하나로 편성된 모든 에이전트 세션 동시 복원

### 4. ⚡ 토큰 최적화 & 스마트 자동 세션 릴레이 (Auto-Handoff Relay)
- **컴팩트 1회 후에도 가득일 때 자동 릴레이**: 임계치 도달 시 1차 `/compact` 압축을 자동 시도하며, 압축 후에도 토큰이 초과되면 새 세션으로 연계
- **Markdown 파일 기반 무손실 인수인계 (`SESSION_HANDOFF.md`)**:
  - 직전 세션 작업 로그 요약, 담당 에이전트 역할, 후속 작업 지침을 `.ai-agents/SESSION_HANDOFF.md` 및 `BLACKBOARD.md`에 실시간 파일 기록
  - 신규 세션 기동 시 인수인계 마크다운 파일을 자동으로 읽고 중단점부터 즉시 연속 작업 수행하도록 프롬프트 자동 주입
- **PC 자원/메모리 과부하 원천 차단 (구 세션 프로세스 즉시 종료)**:
  - 인수인계 완료 즉시 직전 세션의 PTY 프로세스를 안전하게 종료(`apiStopSession`) 및 메모리에서 해제하여 세션 누적으로 인한 PC 버벅임 방지
- **원클릭 수동 릴레이**: 터미널 상단 `[릴레이]` 버튼 클릭으로 원할 때 언제든 즉시 다음 세션으로 안전 인수인계 및 구 세션 정리 가능

### 5. 🛡️ 시스템 트레이(System Tray) 백그라운드 상주 & 세션 보호
- 창 닫기(`X`) 클릭 시 작업 중인 터미널이 있으면 **[트레이로 숨기기]** 확인 모달로 세션 유실 방지
- 트레이 우클릭 컨텍스트 메뉴 (`AgentriX 열기`, `한도 현황 새로고침`, `완전 종료`)
- 윈도우 11 다크 / 라이트 테마 완벽 동기화 (폴더 탐색 다이얼로그 테마 연동)

---

## ⌨️ 단축키 안내 (Keyboard Shortcuts)

| 단축키 | 동작 |
| :--- | :--- |
| **`Alt + 1` ~ `Alt + 4`** | 분할 터미널 1번 ~ 4번으로 즉시 키보드 포커스 이동 |
| **`Alt + S`** | 분할 레이아웃 순환 (단일 ↔ 좌우 ↔ 상하 ↔ 4분할) |
| **`Ctrl + 마우스 휠`** | 터미널 글자 크기 실시간 확대 / 축소 |
| **`Ctrl + 0`** | 터미널 글자 크기 기본값(13.5px)으로 원상 복구 |
| **`Ctrl + +` / `Ctrl + -`** | 터미널 글자 크기 1px 단위 확대 / 축소 |
| **`F11`** | 창 최대화 / 이전 크기 복원 토글 |

---

## 🛠️ 빠른 시작 (Quick Start)

### 포터블 바이너리 실행 (무설치)
1. [Releases](https://github.com/TodookGamja/AgentriX/releases) 탭에서 최신 `AgentriX-Portable-v0.1.0-win-x64.zip` 또는 `AgentriX.exe` 다운로드
2. 원하는 폴더에 넣고 바로 더블클릭하여 실행

### 소스코드 빌드 (Build from Source)
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
빌드된 포터블 실행 파일은 `release/AgentriX.exe` 및 `AgentriX-Portable-v0.1.0-win-x64.zip`에 생성됩니다.

---

## 📄 라이선스 (License)

이 프로젝트는 [MIT License](LICENSE)에 따라 자유롭게 사용, 수정, 배포할 수 있습니다.
