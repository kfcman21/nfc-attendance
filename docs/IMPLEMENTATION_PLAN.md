# [구현 계획서] NFC 에듀태그 (NFC EduTag) 리브랜딩 & 지능형 과학실 융합 기능 구현

## 1. 개요
기존 'NFC 학생 출석' 앱의 명칭을 **『NFC 에듀태그 (NFC EduTag)』**로 공식 변경하고, 2022 개정 교육과정 및 **지능형 과학실(Intelligent Science Lab)** 인프라와 연계되는 탐구 스테이션(패스포트), 스마트 교구·시약 안전 관리, 환경 데이터 비교 기능을 프로그램 전반에 통합 구현합니다.

---

## 2. 변경 및 추가 작업 내역

### 2.1 앱 명칭 및 브랜딩 리브랜딩 (Rebranding)
- **앱 공식 명칭**: `NFC 에듀태그 (NFC EduTag)`
- **슬로건/설명**: `스마트 학급 & 지능형 과학실 올인원 솔루션`
- **적용 파일**:
  - `package.json` (`productName`, `description`, `portable.artifactName`)
  - `public/index.html` (브라우저/앱 타이틀, 네비게이션 상단 브랜딩 텍스트, 메인 홈 히어로 배너 문구)
  - `electron-main.mjs` (Electron 윈도우 타이틀)
  - `README.md` (프로젝트 개요 및 문서 타이틀)

### 2.2 지능형 과학실 융합 신규 탭 및 기능 추가
- **1) 과학 탐구 패스포트 (Science Passport / Station Learning)**:
  - 과학실 내 실험 코너(현미경 존, MBL 센서 존, 스마트팜 식물 존 등)에 부여된 태그 스캔 시 탐구 미션 이수 등록 및 스탬프 적립
- **2) 스마트 교구 & 시약 안전 관리 (Smart Tools & Safety)**:
  - MBL 센서, 디지털 현미경 등 과학 교구 NFC 대여/반납
  - 시약/실험도구 태그 시 화면에 **실험 안전 수칙(MSDS)** 팝업 표출
- **3) 실내외 환경 데이터 비교 위젯 (Environmental Data Science)**:
  - 앱 내 기상청/에어코리아 실시간 대기 공공데이터와 지능형 과학실 실내 센서 측정치 비교 화면 제공

### 2.3 데이터베이스 및 백엔드 확장 (`src/db.mjs`, `src/server.mjs`)
- **신규 테이블 자동 마이그레이션 (`CREATE TABLE IF NOT EXISTS`)**:
  - `science_stations`: 과학실 탐구 스테이션 정의
  - `science_records`: 학생별 스테이션 탐구 완료 기록
  - `science_tools`: 과학 교구 및 시약 안전 정보 등록 (이름, 분류, 안전수칙, 대여 상태)
  - `science_tool_loans`: 교구 대여/반납 이력
- **신규 REST API 추가**:
  - `GET /api/science/overview`: 과학실 탐구 및 교구 현황
  - `POST /api/science/stations`: 탐구 스테이션 등록/조회
  - `POST /api/science/tools`: 교구 등록/대여/반납 처리
  - `GET /api/export/science.csv`: 과학 탐구 및 교구 이력 엑셀(CSV) 내보내기

### 2.4 프론트엔드 UI 확장 (`public/index.html`, `public/app.js`, `public/style.css`)
- 상단 네비게이션에 **🔬 지능형 과학실** 탭 추가
- 메인 홈 대시보드에 **지능형 과학실 바로가기 카드** 추가
- 과학실 전용 뷰(탐구 패스포트 현황, 스마트 교구 대여함, 환경 데이터 비교판) 구현
- 데이터 관리 탭 내 '지능형 과학실 데이터 엑셀 내보내기' 및 초기화 옵션 추가

---

## 3. 진행 단계 (Step-by-Step)
1. **[Step 1]** 메타데이터 및 브랜드 명칭 업데이트 (`package.json`, `electron-main.mjs`, `README.md`)
2. **[Step 2]** DB 스키마 및 백엔드 API 확장 (`src/db.mjs`, `src/server.mjs`)
3. **[Step 3]** 프론트엔드 HTML 구조 및 지능형 과학실 탭 추가 (`public/index.html`)
4. **[Step 4]** 프론트엔드 CSS 스타일링 및 JS 기능 구현 (`public/style.css`, `public/app.js`)
5. **[Step 5]** 데이터 내보내기/백업 연동 및 최종 테스트 검증

---

## 4. 안전성 및 호환성 보장
- 기존의 학생 출석, 주간 점수, 감정 출석, 포인트 상점, 체육(셔틀런/서킷), 도서 대여 데이터 및 동작은 100% 온전히 유지됩니다.
- 모든 데이터베이스 확장은 기존 데이터를 훼손하지 않는 안전한 `IF NOT EXISTS` 마이그레이션 방식으로 진행됩니다.
