# 🎨 NFC 에듀태그 인포그래픽 제작 브리프 v3.0

**대상 버전**: `v1.13.4` · **작성 기준일**: 2026-08-16
**용도**: 공식 홍보/안내 포스터(3D 실물 디바이스형 · 2D 플랫 일러스트형) 제작을 위한 최종 원고 및 디자인 명세
**적용 범위**: 캔바/미리캔버스 수작업 배치, AI 이미지 생성(DALL·E 3 / Midjourney v6 / Imagen), 외주 디자이너 발주서

> 본 문서는 `INFOGRAPHIC_PROMPT_GUIDE.md`(v2.1)와 `infographic-text.md`를 통합·갱신한 최신본입니다.
> v2.1 대비 **9번째 핵심 기능 「인간 협업형(HITL) AI 교육 스튜디오」** 영역이 신규 반영되었습니다.
> 산출물은 `public/infographic_device.jpg`(3D 실물형), `public/infographic_illust.jpg`(2D 일러스트형)로 교체 배포합니다.

### ✅ 채택본 (v1.13.5 배포 반영)

**클레이(claymation) 3D 스타일 가로형 8카드 인포그래픽**이 최종 채택되어 `public/infographic.jpg`,
`public/infographic_device.jpg`, `public/infographic_illust.jpg` 세 파일 모두에 동일하게 반영되었습니다.

- **타이틀**: "NFC 에듀태그, 카드 한 장으로 여는 스마트 학급과 지능형 과학실"
- **레이아웃**: 가로형 4열 × 2행 = 8카드 (아래 §3의 3:4 세로 구조도는 인쇄 포스터용 대안안으로 유지)
- **채택 8카드**: 스마트 출결 / 감정 케어 / 과학실 탐구 / 안전 관리 / 체력·독서·자치 / **교사 검토 승인** / **감사 추적 학습** / 안심 보안
- **HITL 반영**: 「교사 검토 승인」(AI 초안 생성 → 교사 검토·수정 → 교사 승인 → 학생에게 배포)과
  「감사 추적 학습」(탐지→진단→조치→개선 + 4단계 피드백) 두 카드로 분리 표현

---

## 1. 제작 개요

| 항목 | 명세 |
|---|---|
| **정식 명칭** | NFC 에듀태그 (NFC EduTag) |
| **한 줄 소개** | 카드 한 장으로 학생 출결·감정 케어부터 지능형 과학실 MBL 탐구·로봇 피지컬 AI까지 원터치로 해결하는 미래형 스마트 스쿨 올인원 솔루션 |
| **메인 카피** | **"카드 한 장으로 열어가는 스마트 학급 & 지능형 과학실 하루"** |
| **서브 카피** | 사람이 최종 결정하는 인간 협업형(HITL) AI 에듀테크 |
| **규격 (기본)** | 1200 × 1600 px (3:4 세로 포스터), 300dpi 인쇄 시 A3 대응 |
| **규격 (보조)** | 1920 × 1080 px (16:9 전자칠판/발표 슬라이드용) |
| **버전 표기** | 우측 하단 `v1.13.4` 작게 표기 |
| **주 사용처** | 학교 게시판 인쇄, 발표 자료 표지, 앱 내 「설명자료」 탭 |

---

## 2. 디자인 토큰 (색상 · 타이포 · 형태)

### 2-1. 컬러 팔레트

| 역할 | 색상명 | HEX | 사용처 |
|---|---|---|---|
| **Primary** | 코발트 블루 | `#0064E0` | 헤더 밴드, 주요 제목, 카드 번호 배지 |
| **AI Accent 1** | 솔라 퍼플 | `#7B2CBF` | Upstage Solar AI 관련 요소 그라데이션 시작 |
| **AI Accent 2** | 솔라 오렌지 | `#FF7B00` | Solar AI 그라데이션 종료, 강조 하이라이트 |
| **Success** | 에메랄드 그린 | `#00B894` | 과학실/센서/완주 스탬프 |
| **HITL** | 딥 인디고 | `#3B3FA1` | 교사 검토·승인(HITL) 영역 전용 |
| **Warning** | 세이프티 옐로 | `#FED156` | MSDS 안전 수칙, 주의 배지 |
| **Base BG** | 웜 화이트 | `#F8FAFC` | 전체 배경 |
| **Text** | 잉크 다크 | `#191E24` | 본문 |
| **Muted** | 쿨 그레이 | `#6E7887` | 캡션, 각주 |

### 2-2. 타이포그래피

- **국문**: 진한 굴림체(Gulim Ultra-Bold) — 전자칠판 원거리 가독성 최우선
- **대체 폰트**: Pretendard Bold / 나눔스퀘어 ExtraBold
- **영문·숫자**: Montserrat ExtraBold
- **위계**: 메인 타이틀 72pt / 영역 제목 36pt / 카드 헤드라인 24pt / 본문 16pt / 캡션 12pt

### 2-3. 형태 규칙

- 카드: 라운드 24px, 1px 보더(`#CDD4DC`), 그림자 최소화(플랫 지향)
- 아이콘: 선 굵기 3px 통일, 단색 + 포인트 컬러 1개
- 연결선: 데이터 흐름은 점선 + 화살촉, 코발트 블루

---

## 3. 레이아웃 구조도 (3:4 세로 포스터)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 🪪 [HEADER] NFC 에듀태그 (NFC EduTag)                                     │
│    "카드 한 장으로 열어가는 스마트 학급 & 지능형 과학실 하루"                 │
│    ─ 사람이 최종 결정하는 인간 협업형(HITL) AI 에듀테크 ─                    │
├───────────────────────────────────────────────────────────────────────────┤
│ [ZONE A] 아침 맞이 & AI 감정 케어                          (코발트 블루)   │
│ ① 🪪 스마트 정시 출석체크        │ ② 🤖 Solar AI 감정 출석부              │
├───────────────────────────────────┼───────────────────────────────────────┤
│ [ZONE B] 🔬 지능형 과학실 피지컬 컴퓨팅                    (에메랄드 그린) │
│ ③ 📡 SciBit 마이크로비트 MBL     │ ④ 🤖 SciBot 햄스터 피지컬 AI          │
│ ⑤ 🚀 탐구 패스포트 스탬프 랠리   │ ⑥ 🛡️ 스마트 교구 & 시약 안전 지킴이    │
├───────────────────────────────────┼───────────────────────────────────────┤
│ [ZONE C] 체력·독서·학급 자치                               (솔라 오렌지)   │
│ ⑦ 🏃 스마트 PAPS & AI 체력코칭   │ ⑧ 📚 손바닥 도서관 & 지구 포인트 상점  │
├───────────────────────────────────────────────────────────────────────────┤
│ [ZONE D] ⭐ 인간 협업형(HITL) AI 교육 스튜디오            (딥 인디고/강조) │
│ ⑨ 🧑‍🏫 AI-SPARC 수업 설계기 · Level 3 교사 검토·승인 센터                  │
│    · 4단계 AI 감사 추적 활동지 제작기 · 피드백 태깅 분석 대시보드            │
│    ▶ 「탐지 → 진단 → 조치」 DDA 순환 루프 다이어그램 삽입                   │
├───────────────────────────────────────────────────────────────────────────┤
│ [ZONE E] 신뢰의 인프라   ⚡ Upstage Solar LLM  │  🔐 100% 로컬 보안        │
├───────────────────────────────────────────────────────────────────────────┤
│ 🏫 [FOOTER] 2022 개정 교육과정 연계 · 2026 기업 연계 정보교원 역량강화     │
│    프로젝트 · 초등 정보 융합 분반 · NFC 에듀태그 팀        v1.13.4         │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 카드별 확정 원고 (그대로 복사해 배치)

| # | 아이콘 | 카드 헤드라인 (진한 굴림체) | 세부 설명 문구 | 컬러 | 연계/엔진 |
|---|---|---|---|---|---|
| **①** | ⏱️🪪 | **스마트 정시 출석체크** | 카드를 대면 정시 출석 점수가 쏙! 스스로 등교 습관 형성 | Primary | 정시/지각 점수제 |
| **②** | 🤖💬 | **Solar AI 감정 출석부** | 6단계 마음 날씨 체크 후 업스테이지 AI가 전하는 맞춤 응원 | AI Accent | Upstage Solar LLM |
| **③** | 📡🌡️ | **SciBit 마이크로비트 MBL** | micro:bit v2 센서(온도·조도·소음·가속도) 실시간 측정·기록 | Success | `kfcman.link/scibit` |
| **④** | 🤖🌱 | **SciBot 햄스터 피지컬 AI** | 햄스터 로봇 온실 순찰 & 자율주행 환경 탐사 미션 출동 | Success | `kfcman.link/scibot` |
| **⑤** | 🚀💮 | **지능형 과학실 패스포트** | 탐구 코너마다 태그하고 스탬프 랠리 완주! 탐구 포트폴리오 | Success | Station Learning |
| **⑥** | 🛡️📦 | **스마트 교구 & 시약 지킴이** | NFC 원터치 대여/반납 및 MSDS 실험 안전 수칙 실시간 팝업 | Warning | 안전한 과학실 |
| **⑦** | 🏃📈 | **스마트 PAPS & AI 코칭** | 셔틀런 왕복 자동 기록과 Solar AI 개인별 맞춤 체력 피드백 | AI Accent | Upstage AI 체육 분석 |
| **⑧** | 📚⭐ | **손바닥 도서관 & 지구포인트** | 책에 카드를 톡! 독서 온도계와 1인 1역할 학급 화폐 경제 실습 | AI Accent | 독서 & 학급 자치 |
| **⑨** | 🧑‍🏫✅ | **HITL AI 교육 스튜디오** | AI 초안을 교사가 검토·수정·승인한 뒤에만 학생에게 배포 | **HITL** | **AI-SPARC · 감사 추적** |
| **인프라** | ⚡🔐 | **초거대 AI & 안심 보안** | API 키 AES-256-GCM 암호화 & 100% 로컬 SQLite 데이터 보호 | Primary | 오프라인 완전 구동 |

---

## 5. ZONE D 전용 상세 원고 (HITL 영역 · 이번 버전 신규)

이 영역이 본 프로젝트를 다른 에듀테크와 구분 짓는 **핵심 차별점**이므로, 포스터에서 가장 눈에 띄는 강조 블록으로 처리합니다.

### 5-1. 영역 헤드라인
> **"AI는 초안을 쓰고, 최종 결정은 선생님이 합니다"**
> 인간 협업형(Human-in-the-Loop) Level 3 중간 자동화

### 5-2. DDA 순환 루프 다이어그램 텍스트

```
        [ 인간 교사의 주체성 (Agency) ]
          High Touch · 1:1 공감 지도
                    │ Level 3 검토·승인
   ┌────────────┐   ▼   ┌────────────┐     ┌────────────┐
   │ 탐지 Detect│ ───▶ │ 진단 Diagnose│ ──▶ │  조치 Act  │
   │ NFC·센서   │      │  AI 초안 제안 │     │ 맞춤형 배움 │
   └────────────┘      └────────────┘     └────────────┘
                    │
        [ 학생의 메타인지 (Audit Trail) ]
   ①인간 탐구 ➔ ②구조적 질문 ➔ ③피드백 태깅 ➔ ④비판적 교정
```

### 5-3. 교사용 AI-SPARC 5단계 (아이콘 5개 가로 배치)

| 단계 | 이름 | 한 줄 설명 |
|---|---|---|
| **S** | Self-Reflect | 교육 목표와 나의 교육 철학 자가 성찰 |
| **P** | Prompt (TRACI) | 작업·역할·대상·형식·의도로 구조화된 질문 |
| **A** | Academic | 2022 개정 교육과정 성취기준 바인딩 |
| **R** | Research | 비고츠키 ZPD·피아제 인지적 불평형 이론 제약 |
| **C** | Critique | 교사의 최종 비판 검토 및 수업 맥락화 |

### 5-4. 학생용 AI 감사 추적 4단계 (번호 스텝 배치)

1. **인간 독자 탐구** — AI에게 묻기 전, 나만의 가설을 먼저 세운다
2. **구조적 질문** — TRACI 형식으로 정확하게 물어본다
3. **피드백 태깅** — 정확성·명확성·적절성 3대 메타 태그로 AI 답변을 평정한다
4. **비판적 교정** — AI의 오류를 찾아 고치고, 나만의 언어로 완성한다

---

## 6. 숫자로 보는 시스템 (아이콘 통계 스트립용)

| 숫자 | 라벨 |
|---|---|
| **1장** | 학생당 필요한 NFC 카드 |
| **9대** | 통합 핵심 기능 |
| **6단계** | 매일 아침 마음 날씨 체크 |
| **2대** | 연계 피지컬 교구 (micro:bit v2 · 햄스터 로봇) |
| **Level 3** | 교사 검토·승인 기반 중간 자동화 |
| **AES-256** | 로컬 암호화 보안 등급 |
| **0원** | 서버 유지비 (교실 PC 단독 구동) |

---

## 7. 동작 흐름 다이어그램 원고 (화살표 배치용)

```
NFC 카드 태그 → 학생·교구 인식 → 로컬 SQLite 기록(출결/스탬프/대여)
   → Upstage Solar AI 피드백 초안 생성 → 🧑‍🏫 교사 Level 3 검토·승인
   → 대형 모니터 실시간 표출 → 원클릭 엑셀(CSV) 내보내기
```

**핵심 강조점**: `교사 Level 3 검토·승인` 노드를 다른 노드보다 크게, 딥 인디고 테두리로 처리하여 "AI가 곧바로 학생에게 가지 않는다"는 메시지를 시각화합니다.

---

## 8. AI 이미지 생성 프롬프트

### 🎨 스타일 1 — 3D 아이소메트릭 실물 디바이스형 (`infographic_device.jpg` 계열, 추천)

```text
A high-resolution 3D isometric educational infographic poster titled "NFC EduTag: Smart Classroom, Intelligent Science Lab, and Human-in-the-Loop AI".
Bright modern Korean elementary classroom, cobalt blue (#0064E0), Solar AI purple-to-orange gradient (#7B2CBF to #FF7B00), emerald green (#00B894), and deep indigo (#3B3FA1) accents on a clean warm-white backdrop.
Interconnected smart learning zones linked by glowing dotted data trails:
1) Attendance & Emotion Zone: cute students tapping NFC cards on a desktop card reader, a floating holographic AI assistant showing cheerful speech bubbles with mood icons.
2) SciBit MBL Lab: a BBC micro:bit v2 board wired to temperature, light, sound, and accelerometer gauges.
3) SciBot Physical AI Lab: a small Hamster robot patrolling a miniature smart greenhouse track with obstacle avoidance.
4) Passport Station: a glowing exploration passport book filling with shiny achievement stamps.
5) Smart Tool & MSDS Safety Cabinet: microscopes and labeled chemical bottles with RFID tags and a yellow safety badge.
6) Smart PE Zone: a shuttle-run track with cones, lap timer, and an AI fitness growth chart.
7) Micro-library & Class Economy: a book lending scanner and golden reward coins.
8) CENTERPIECE - Human-in-the-Loop AI Studio: a teacher figure at a review desk holding a large glowing APPROVE checkmark stamp, inspecting an AI-generated draft card on a floating screen before it is released to students; a circular Detect-Diagnose-Act loop diagram orbits the desk.
9) Secure Core: a glowing encrypted chip with a padlock (AES-256, local-only database).
Pixar-style 3D characters, crisp studio lighting, clean bento-card composition, no messy text artifacts, no gibberish lettering. --ar 3:4 --v 6.0
```

### 🎨 스타일 2 — 2D 플랫 벡터 에듀테크 UI형 (`infographic_illust.jpg` 계열)

```text
Professional 2D flat vector infographic poster for the Korean elementary school platform "NFC EduTag".
Neatly arranged bento card grid with bold typographic blocks:
- Header band: NFC EduTag - Smart Classroom & Intelligent Science Lab.
- Card 1: NFC student ID card with a green on-time attendance check.
- Card 2: AI speech bubble with six mood emojis.
- Card 3: micro:bit v2 board with live sensor meters.
- Card 4: autonomous hamster robot explorer on a greenhouse track.
- Card 5: mission passport with colorful completion stamps.
- Card 6: beaker and microscope with an MSDS safety badge.
- Card 7: running track with stopwatch and AI growth trendline.
- Card 8: bookshelf with RFID scan beam and reward token store.
- HIGHLIGHT BANNER (deep indigo #3B3FA1, largest block): a teacher icon reviewing and approving an AI draft, with a three-step Detect - Diagnose - Act circular loop and a four-step student audit trail (Inquire, Ask, Tag, Revise).
- Footer card: encrypted chip badge for Upstage Solar API key and local SQLite storage.
Palette: cobalt blue, solar orange, mint emerald, deep indigo, crisp white. Bold line vectors, high readability, flat shading, no photorealism. --ar 3:4
```

### 🎨 스타일 3 — 16:9 발표 슬라이드 표지형 (보조)

```text
Wide 16:9 flat vector title banner for "NFC EduTag - Smart Classroom & Intelligent Science Lab All-in-One Solution".
Left side: bold Korean-style typographic title block on warm white.
Right side: an isometric cluster of an NFC card reader, micro:bit board, hamster robot, passport stamp book, and a teacher approving an AI draft card.
Cobalt blue and solar orange gradient accents, deep indigo highlight on the teacher-approval element. Clean, presentation-ready, generous negative space. --ar 16:9
```

> **AI 생성 시 주의**: 이미지 모델은 한글 텍스트를 정확히 렌더링하지 못합니다.
> 반드시 **텍스트 없는 일러스트만 생성**한 뒤, 캔바/미리캔버스에서 4장(카드 원고)과 5장(HITL 원고)의 한글 문구를 진한 굴림체로 직접 올려 완성합니다.

---

## 9. 제작 체크리스트

- [ ] 9대 핵심 기능이 모두 카드로 존재하는가 (①~⑨)
- [ ] **ZONE D(HITL)가 다른 영역보다 시각적으로 크고 강조되어 있는가** — 본 프로젝트의 차별점
- [ ] `kfcman.link/scibit`, `kfcman.link/scibot` 주소가 오탈자 없이 표기되었는가
- [ ] "Upstage Solar" 표기가 일관되는가 (업스테이지 솔라 X, Upstage Solar O)
- [ ] 학생 실명·사진·번호 등 개인정보가 예시로도 노출되지 않았는가 (가상의 이름만 사용)
- [ ] 원거리(3m 이상)에서 카드 헤드라인이 읽히는가 — 전자칠판 표출 테스트
- [ ] 라이트/다크 배경 어디에 걸어도 대비가 유지되는가
- [ ] 하단 푸터에 프로젝트 맥락과 버전(`v1.13.4`)이 표기되었는가
- [ ] 최종본을 `public/infographic_device.jpg` / `public/infographic_illust.jpg`로 교체하고 앱 「설명자료」 탭에서 렌더링 확인

---

## 10. 관련 문서

| 문서 | 용도 |
|---|---|
| `docs/INFOGRAPHIC_PROMPT_GUIDE.md` | v2.1 구버전 프롬프트 가이드 (참고용) |
| `docs/infographic-text.md` | 초기 텍스트 원고 (참고용) |
| `docs/HITL_AI_LESSON_PLAN_AND_WORKSHEETS.md` | ZONE D 원고의 근거가 되는 지도안·활동지 |
| `docs/(완성본)해커톤_팀_활동_기획서_NFC에듀태그.pptx` | 동일 내용의 4쪽 기획서 |
| `tools/build_perfect_pptx.py` | 기획서 PPTX 생성 스크립트 |
