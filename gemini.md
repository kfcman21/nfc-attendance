# 🤖 GEMINI.md — NFC 에듀태그 (NFC EduTag) 프로젝트 가이드

본 문서는 **Claude Code CLI** 및 AI 페어 프로그래밍 어시스턴트가 프로젝트의 아키텍처, 교육학적 설계 원칙(HITL & AI-SPARC), 빌드/배포 워크플로, 코딩 컨벤션을 이해하고 안전하게 작업할 수 있도록 작성된 종합 지침서입니다.

---

## 📌 1. 프로젝트 개요

- **프로젝트명**: NFC 에듀태그 (NFC EduTag) - 스마트 학급 & 지능형 과학실 올인원 솔루션
- **현재 버전**: `v1.13.4`
- **프로젝트 맥락**: 2026 기업 연계 정보교원 역량강화 프로젝트 · 해커톤 팀 기획서 (초등 정보 융합 분반)
- **주요 9대 핵심 기능**:
  1. **스마트 출석 & 감정 출석부**: NFC 태그 기반 등교 체크, 6단계 감정 선택 및 Upstage Solar AI 마음 피드백
  2. **지구 살리기 포인트 상점**: 환경 실천 포인트 적립, 학급 화폐 및 쿠폰 경제 실습
  3. **손바닥 NFC 도서관**: 학급문고 원터치 대여·반납, 독서 온도계 및 AI 책 추천
  4. **스마트 체육 (PAPS & 서킷)**: 셔틀런 왕복 달리기 자동 측정, 스테이션 서킷 트레이닝 및 AI 체력 코칭
  5. **지능형 과학실 탐구 패스포트**: 스테이션별 태깅 미션 완주 스탬프 랠리 자동화
  6. **스마트 교구 & 시약 안전 지킴이**: NFC 원터치 대여/반납 및 MSDS 실험 안전 수칙 실시간 팝업 안내
  7. **SciBit 마이크로비트 MBL 연계**: micro:bit v2 실시간 환경 센서(온도·조도·소음·가속도) 수집 (`kfcman.link/scibit`)
  8. **SciBot 햄스터 피지컬 AI 탐사 연계**: 햄스터 로봇 온실 순찰 & 자율주행 탐사 스탬프 발급 (`kfcman.link/scibot`)
  9. **인간 협업형(HITL) AI 교육 스튜디오**: AI-SPARC 수업 설계기, Level 3 피드백 검토/승인 센터, 4단계 AI 감사 추적(AI Audit Trail) 활동지 제작기, 피드백 태깅 분석 대시보드
  10. **🖥 바탕화면 달력 연동**: 설정 탭에서 별도 프로젝트(`C:\Users\박찬규\Desktop\Project\calendar`)로 만든 데스크톱 달력 앱의 설치 파일(exe)을 원클릭으로 실행. 서버(`src/server.mjs`)가 `config.tools.desktopCalendarPath` 경로의 exe를 `spawn`으로 실행하며, `GET/POST /api/tools/desktop-calendar(/launch)` 엔드포인트로 노출. calendar 프로젝트가 새 버전으로 빌드될 때마다 `desktopCalendarPath` 값을 최신 exe 파일명으로 갱신해야 함(개인 사용 목적이라 절대경로 하드코딩 허용, 배포용 아님).

---

## 🏛️ 2. 교육학적 설계 원칙 (Pedagogy-First & HITL)

본 프로젝트는 **「인간 협업형 교육용 AI 설계와 HITL 프레임워크」** 및 **「AI 프롬프트 설계 & AI 감사 추적 실전 가이드라인」**을 엄격히 준수합니다.

```
                  ┌────────────────────────────────────────┐
                  │      인간 교사의 주체성 (Agency)       │
                  │   High Touch (1:1 공감, 가치관 지도)   │
                  └──────────────────┬─────────────────────┘
                                     │ (Level 3 검토·승인)
┌──────────────────────┐   ┌─────────▼────────┐   ┌──────────────────────────┐
│     탐지 (Detect)    │──▶│   진단 (Diagnose) │──▶│        조치 (Act)        │
│   NFC 태그 / 센서    │   │ AI 초안 분석 제안│   │ 학생 맞춤형 비판적 배움  │
└──────────────────────┘   └──────────────────┘   └──────────────────────────┘
                                     │
                  ┌──────────────────┴─────────────────────┐
                  │      학생의 메타인지 (Audit Trail)     │
                  │  ①인간탐구 ➔ ②질문 ➔ ③태깅 ➔ ④교정  │
                  └────────────────────────────────────────┘
```

1. **DDA 순환 루프 & Level 3 중간 자동화**:
   - 단순 정답 기계(완전 자동화) 배제. AI가 제안한 피드백을 **교사가 비판적으로 검토·수정 및 최종 승인(Critique & Approve)**한 후 배포.
2. **교사용 AI-SPARC 5단계 성찰 주기**:
   - `S (Self-Reflect)`: 교육 목표 및 교사의 교육 철학 자가 성찰
   - `P (Prompt with TRACI)`: Task(작업), Role(역할), Audience(대상), Create(형식), Intent(의도) 구조화
   - `A (Academic Requirements)`: 2022 개정 교육과정 공식 성취기준 바인딩
   - `R (Research on Pedagogy)`: 비고츠키(ZPD/비계설정), 피아제(인지적 불평형) 등 교육학 이론 룰 제약
   - `C (Critique)`: 교사의 최종 비판 검토 및 수업 맥락화
3. **학생용 AI 감사 추적 (AI Audit Trail) 4단계**:
   - `Step 1`: 인간 독자 탐구 (AI 전 나만의 가설/생각 먼저 정립)
   - `Step 2`: 구조적 질문 (TRACI 기반 프롬프팅)
   - `Step 3`: 피드백 태깅 (정확성 Correctness, 명확성 Clarity, 적절성 Tone 3대 메타 태그 평정)
   - `Step 4`: 비판적 교정 및 안착 (AI 오류 수정, 나만의 언어로 완성)

---

## 📂 3. 프로젝트 디렉토리 구조

```
nfc/
├── src/                      # 백엔드 소스코드 (Node.js ESM)
│   ├── server.mjs            # Express API 서버, 리더기 통신, 라우트 정의
│   ├── ai.mjs                # Upstage Solar LLM & HITL 프롬프트 엔진
│   ├── db.mjs                # SQLite 데이터베이스 (node:sqlite)
│   ├── reader.mjs            # SerialPort 기반 CR-100 NFC 리더기 드라이버
│   ├── parser.mjs            # STX-ETX 카드 데이터 파서
│   └── secret.mjs            # AES-256-GCM 암호화/복호화 유틸
├── public/                   # 프론트엔드 정적 웹 리소스 (Vanilla JS/CSS)
│   ├── index.html            # 메인 단일 페이지 (모든 탭 & HITL 스튜디오 UI)
│   ├── app.js                # 클라이언트 로직, SSE 이벤트, HITL 컨트롤러
│   ├── style.css             # 반응형 스타일, 라이트/다크 테마, HITL 컴포넌트
│   ├── infographic_device.jpg# 3D 실물 디바이스형 인포그래픽
│   ├── infographic_illust.jpg# 2D 일러스트형 인포그래픽
│   ├── manifest.webmanifest  # PWA 매니페스트
│   └── sw.js                 # PWA 서비스워커
├── docs/                     # 교육과정 지도안, 활동지, 기획 문서
│   ├── HITL_AI_LESSON_PLAN_AND_WORKSHEETS.md  # 2022 개정 HITL 지도안 및 활동지
│   └── ...
├── data/                     # 로컬 데이터 (gitignore)
│   ├── attendance.db         # SQLite 데이터베이스 파일
│   ├── settings.json         # 암호화된 API 키 및 시스템 설정
│   └── .secret.key           # AES-256 암호화 시크릿 키
├── electron-main.mjs         # Electron 데스크톱 앱 메인 프로세스
├── package.json              # 패키지 명세 및 빌드 스크립트 (v1.13.2)
└── config.json               # 기본 설정 템플릿
```

---

## 🛠️ 4. 개발 및 빌드 명령어

```bash
# 1. 데스크톱 앱 실행 (Electron + 내부 Express 서버)
npm start

# 2. 웹 서버만 단독 실행 (개발/디버그)
npm run server

# 3. 배포용 실행 파일 패키징 (Windows NSIS 설치형 & Portable 무설치형)
npm run dist

# 4. 리더기 시리얼 통신 스니핑 도구
npm run sniff
```

---

## 🔒 5. 보안 및 코딩 규칙 (절대 준수)

1. **무조건 한국어 작성**: 모든 주석, 설명, 커밋 메시지, 사용자 인터랙션은 자연스러운 한국어로 작성합니다.
2. **보안 및 암호화 최우선**:
   - 학생 이름, 출석 번호, UID, 외부 API 키(Upstage Solar, NEIS)는 절대 평문으로 노출하거나 git에 커밋하지 않습니다.
   - API 키는 `secret.mjs`의 AES-256-GCM (`enc:v1:...`) 암호문으로만 저장/전송합니다.
3. **코드 생략 절대 금지**: 파일 수정 시 `// ... 기존 코드 ...` 형태로 생략하지 말고 완벽한 복사-붙여넣기가 가능한 전체/일관된 코드를 유지합니다.
4. **포트 충돌 관리**: 서버 포트(`3000`, HTTPS `3443`)는 백그라운드 프로세스 종료 시 반드시 클린업합니다.
5. **안전성 우선**: 기존의 안정적인 기능(NFC 출석, 체육, 과학실 MBL 등)을 훼손하지 않도록 주의합니다.
