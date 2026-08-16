// ==============================================================================
// 업스테이지(Upstage) Solar LLM 연동 및 인간 협업형(HITL) 교육용 AI 프롬프트 엔진
// 
// [설계 철학: Pedagogy-First & Level 3 Human-in-the-Loop (HITL)]
// 1. DDA 프레임워크: 탐지(Detect) -> 진단(Diagnose) -> 조치(Act) 순환 고리 지원
// 2. 교사용 AI-SPARC 프롬프트 주기 (Self-reflect, Prompt with TRACI, Academic requirements, Research, Critique)
// 3. 학생용 AI 감사 추적(AI Audit Trail) & 피드백 태깅(Feedback Tagging: Correctness, Clarity, Tone)
// 4. 하이터치 하이테크(HTHT): 기계적 집계는 High Tech, 정서 교감과 최종 가치판단은 High Touch
// ==============================================================================

const UPSTAGE_URL = 'https://api.upstage.ai/v1/chat/completions';

/**
 * Solar 챗 API 한 번 호출. 실패하면 Error를 던집니다.
 * @param {Object} params
 * @param {string} params.apiKey - 업스테이지 API 키
 * @param {string} [params.model='solar-pro2'] - 사용할 모델명
 * @param {string} params.system - 시스템 프롬프트 (페르소나 및 교육학적 룰 제약)
 * @param {string} params.user - 사용자 질문/지시문
 * @param {number} [params.timeoutMs=25000] - 응답 제한 시간(밀리초)
 * @returns {Promise<string>} AI 응답 텍스트
 */
export async function solarChat({ apiKey, model = 'solar-pro2', system, user, timeoutMs = 25000 }) {
  if (!apiKey) throw new Error('업스테이지 API 키가 설정되지 않았습니다. (설정·진단 탭에서 입력)');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(UPSTAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        max_tokens: 1400,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 200);
      try { msg = JSON.parse(text).error?.message || msg; } catch {}
      throw new Error(`업스테이지 API 오류 (HTTP ${res.status}): ${msg}`);
    }
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('업스테이지 응답이 비어 있습니다.');
    return content;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('업스테이지 API 응답 시간 초과');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 감정 상태 라벨 매핑
const MOOD_LABEL = {
  great: '아주 좋아요 😄',
  good: '좋아요 🙂',
  soso: '그저 그래요 😐',
  tired: '피곤해요 😫',
  sad: '슬퍼요 😢',
  angry: '화나요 😡',
};

// 기본 교육용 시스템 프롬프트 (HITL 및 아동 친화적 원칙 준수)
const BASE_SYSTEM =
  '너는 한국 초등학교 담임 선생님을 돕는 따뜻한 학급 도우미 AI야. ' +
  '항상 한국어 존댓말로, 초등학생과 선생님이 함께 읽기 좋은 쉽고 긍정적인 말투로 답해. ' +
  '이모지를 적절히(과하지 않게) 사용하고, 비난·비교 대신 격려와 구체적인 칭찬을 해. ' +
  '답변은 마크다운 없이 짧은 문단이나 "-" 목록으로 간결하게 작성해.';

// ==============================================================================
// 1. 기존 학급 기능별 AI 피드백 프롬프트 (감정출석, 도서, 포인트, 체육)
// ==============================================================================

/**
 * ① 감정출석부 통계 피드백 — 반 분위기 진단 + 선생님을 위한 제안
 */
export function moodPrompt(stats) {
  const dist = Object.entries(stats.byMood || {})
    .map(([k, v]) => `${MOOD_LABEL[k] || k}: ${v}회`)
    .join(', ') || '기록 없음';
  const concern = (stats.concern || [])
    .slice(0, 5)
    .map((c) => `${c.name || '이름없음'}(부정 감정 ${c.total}회)`)
    .join(', ') || '없음';
  return {
    system: BASE_SYSTEM,
    user:
      `우리 반 감정출석부 통계(${stats.from}~${stats.to})를 보고 피드백을 해줘.\n` +
      `- 총 기록 수: ${stats.total}회\n` +
      `- 감정 분포: ${dist}\n` +
      `- 긍정 비율: ${stats.positiveRatio}% (긍정 ${stats.positive}, 보통 ${stats.neutral}, 부정 ${stats.negative})\n` +
      `- 평균 감정 점수: ${stats.score} (-2~+2)\n` +
      `- 반 감정 날씨: ${stats.weather?.emoji || ''} ${stats.weather?.label || ''}\n` +
      `- 관심이 필요한 학생: ${concern}\n\n` +
      `아래 순서로 넉넉하고 정성스럽게(10문장 내외) 피드백해줘:\n` +
      `1) 반 전체 분위기를 두세 문장으로 따뜻하게 요약\n` +
      `2) 우리 반이 잘하고 있는 점을 구체적으로 칭찬 (감정 기록에 성실히 참여한 것 포함)\n` +
      `3) 관심이 필요한 학생이 있으면 낙인찍지 않으면서 선생님이 어떻게 다가가면 좋을지 다정한 조언\n` +
      `4) 교실에서 해볼 만한 감정·관계 활동 3가지 (활동명과 방법 한 줄씩)\n` +
      `5) 마지막으로 우리 반 모두에게 보내는 응원 한 줄`,
  };
}

/**
 * ①-b 감정 체크 직후 학생에게 보여줄 짧은 긍정 피드백 (출석 오버레이용)
 */
export function moodCheckinPrompt(studentName, moodKey, recentMoods = []) {
  const recent = recentMoods.length
    ? `\n- 최근 며칠의 기분: ${recentMoods.map((m) => MOOD_LABEL[m] || m).join(' → ')}`
    : '';
  return {
    system: BASE_SYSTEM,
    user:
      `방금 ${studentName} 학생이 아침 출석하면서 오늘 기분을 "${MOOD_LABEL[moodKey] || moodKey}"로 골랐어.${recent}\n\n` +
      `이 학생에게 바로 보여줄 응원 메시지를 만들어줘. 규칙:\n` +
      `- 4~6문장으로 정성껏, 학생 이름을 부르며 시작\n` +
      `- 긍정적 기분이면 함께 기뻐해주고 그 기분을 친구들과 나눌 방법을 하나 권해줘\n` +
      `- 부정적 기분(피곤·슬픔·화남)이면 충분히 공감하고 위로한 뒤, 기분이 나아질 작은 행동 1~2가지를 다정하게 권해줘\n` +
      `- 최근 기분 흐름이 있으면 변화를 알아봐주는 말을 한마디 곁들여줘 (예: "어제보다 기분이 좋아졌네요!")\n` +
      `- 초등학생이 읽는 글이니 쉽고 따뜻하게, 이모지 2~3개`,
  };
}

/**
 * ①-c 감정출석부 기반 긍정 친구관계 멘트 — 서로 챙겨주는 반 분위기 만들기
 */
export function friendshipPrompt(stats) {
  const dist = Object.entries(stats.byMood || {})
    .map(([k, v]) => `${MOOD_LABEL[k] || k}: ${v}회`)
    .join(', ') || '기록 없음';
  const concern = (stats.concern || [])
    .slice(0, 5)
    .map((c) => `${c.name || '이름없음'}(부정 감정 ${c.total}회)`)
    .join(', ') || '없음';
  return {
    system: BASE_SYSTEM,
    user:
      `우리 반 감정출석부 통계(${stats.from}~${stats.to})야.\n` +
      `- 감정 분포: ${dist}\n` +
      `- 긍정 비율: ${stats.positiveRatio}%\n` +
      `- 요즘 마음이 힘들어 보이는 친구: ${concern}\n\n` +
      `이 데이터를 바탕으로 반 친구들끼리 서로 아껴주는 분위기를 만드는 "긍정 친구관계 멘트"를 만들어줘.\n` +
      `- 아침 조회 시간에 선생님이 반 전체에게 읽어줄 수 있는 따뜻한 멘트 2~3문장\n` +
      `- 친구에게 오늘 건네볼 수 있는 다정한 말 예시 2가지 (예: "오늘 같이 놀래?")\n` +
      `- 서로 친해지는 짝/모둠 활동 아이디어 1가지\n` +
      `주의: 특정 학생을 "기분이 안 좋은 아이"로 지목하거나 낙인찍지 말고, 모두가 자연스럽게 서로를 챙기게 표현해줘.`,
  };
}

/**
 * ② 빌린 책 안내 — 책 소개 + 읽기 포인트 + 독후활동 제안
 */
export function bookPrompt(book, { borrower = null, reviews = [] } = {}) {
  const rv = reviews
    .slice(0, 3)
    .map((r) => `"${r.review}" (별점 ${r.rating ?? '-'}점)`)
    .join(', ');
  return {
    system: BASE_SYSTEM,
    user:
      `초등학생이 학급문고에서 책을 빌렸어. 이 책에 대해 안내해줘.\n` +
      `- 책 제목: 『${book.title}』\n` +
      (book.author ? `- 지은이: ${book.author}\n` : '') +
      (borrower ? `- 빌린 학생: ${borrower}\n` : '') +
      (rv ? `- 친구들의 한 줄 평: ${rv}\n` : '') +
      `\n네가 아는 책이라면 어떤 내용의 책인지 한두 문장으로 소개하고(스포일러 금지), ` +
      `잘 모르는 책이라면 제목에서 상상되는 이야기를 궁금증을 자극하게 소개해줘. ` +
      `이어서 읽을 때 눈여겨볼 포인트 1가지와, 다 읽고 해볼 간단한 독후활동 1가지를 제안해줘. 5문장 내외로.`,
  };
}

/**
 * ③ 지구 살리기 포인트 피드백 — 환경 실천 칭찬 + 다음 도전 제안
 */
export function pointsPrompt(student, { rank = null, classSize = null, topPoints = null } = {}) {
  return {
    system: BASE_SYSTEM,
    user:
      `우리 반은 환경 보호 실천(분리수거, 급식 남기지 않기, 전기 아끼기 등)을 하면 ` +
      `"지구 살리기 포인트"를 받는 활동을 하고 있어. 이 학생에게 포인트 피드백을 해줘.\n` +
      `- 학생: ${student.name || `${student.student_no || '?'}번`}\n` +
      `- 현재 포인트: ${student.points || 0}P\n` +
      (rank ? `- 학급 순위: ${classSize ? `${classSize}명 중 ` : ''}${rank}위\n` : '') +
      (topPoints != null ? `- 반 1등 포인트: ${topPoints}P\n` : '') +
      `\n지금까지의 환경 실천이 지구에 어떤 도움이 되는지 초등학생 눈높이로 칭찬해주고, ` +
      `앞으로 해볼 만한 지구 살리기 실천을 1~2가지 제안해줘. 순위가 낮아도 절대 기죽이지 말고 격려해줘. 4~5문장으로.`,
  };
}

/**
 * ④ 운동 기록 긍정 피드백 — 셔틀런·서킷 데이터 기반
 */
export function exercisePrompt({ student = null, shuttle = null, circuit = [], leaderboard = [] } = {}) {
  let lines = '';
  if (student) {
    lines += `- 학생: ${student.name || `${student.student_no || '?'}번`}\n`;
    if (shuttle) {
      lines += `- 셔틀런 최고 기록: ${shuttle.best}왕복, 도전 횟수: ${shuttle.attempts}회`;
      if (shuttle.recent?.length) lines += `, 최근 기록: ${shuttle.recent.join(' → ')}왕복`;
      lines += '\n';
    }
    for (const c of circuit) {
      lines += `- 서킷 "${c.station}" 최고 ${c.best}초`;
      if (c.recent?.length) lines += `, 최근: ${c.recent.join(' → ')}초`;
      lines += '\n';
    }
  } else if (leaderboard.length) {
    lines +=
      '- 반 셔틀런 기록: ' +
      leaderboard
        .slice(0, 10)
        .map((r) => `${r.name} ${r.best}왕복(${r.attempts}회 도전)`)
        .join(', ') +
      '\n';
  }
  return {
    system: BASE_SYSTEM,
    user:
      `초등학생 체육 활동(셔틀런 왕복 달리기, 서킷 트레이닝) 기록이야.\n${lines || '- 아직 기록이 없음\n'}\n` +
      (student
        ? `이 학생의 노력과 성장(기록 변화)을 구체적으로 칭찬하고, 무리하지 않는 다음 목표를 1가지 제안해줘. ` +
          `기록이 줄었어도 도전한 것 자체를 칭찬해줘. 4~5문장으로.`
        : `반 전체의 노력을 칭찬하는 응원 메시지를 만들어줘. 특정 학생만 치켜세우지 말고 모두를 격려해줘. 4~5문장으로.`),
  };
}

// ==============================================================================
// 2. [신규] 인간 협업형(HITL) & AI-SPARC 프롬프트 빌더 엔진
// ==============================================================================

/**
 * ⑤ 교사용 AI-SPARC 기반 수업 지도안 생성 프롬프트
 * S(자가 성찰) -> P(TRACI 구조화) -> A(성취기준 바인딩) -> R(교육학 이론 룰) -> C(비판적 검토)
 */
export function sparcLessonPlanPrompt({
  grade = '초등 5~6학년',
  subject = '실과·정보',
  topic = 'NFC 데이터와 스마트 학급 탐구',
  academicStandard = '[6실04-09] 인공지능과 소프트웨어의 역할을 이해하고 윤리적으로 활용한다.',
  pedagogyTheory = '비고츠키의 사회적 구성주의 및 비계 설정(Scaffolding)',
  intent = '학생들이 데이터의 수집 원리를 이해하고 스스로 비판적 질문을 던지도록 유도',
}) {
  const system =
    '너는 2022 개정 교육과정과 교육공학(Pedagogy-First), 그리고 인간 협업형(HITL) 인공지능 교육에 정통한 수석 장학사 겸 교수설계 전문가야. ' +
    '교사가 수업의 주체(Agency)로서 AI를 파트너로 제어할 수 있도록 실용적이고 체계적인 수업 지도안을 설계해 줘. ' +
    '기계적 자동화보다 교사의 하이터치(High Touch)와 학생의 비판적 탐구(Audit Trail)를 최우선으로 고려해.';

  const user =
    `[교사용 AI-SPARC 수업 지도안 설계 요청]\n\n` +
    `1. 대상 및 교과: ${grade} / ${subject}\n` +
    `2. 수업 주제: 『${topic}』\n` +
    `3. 2022 개정 성취기준: ${academicStandard}\n` +
    `4. 적용 교육학 이론: ${pedagogyTheory}\n` +
    `5. 수업 설계 의도(Intent): ${intent}\n\n` +
    `[요구 양식]:\n` +
    `아래 4개 항목을 명확한 번호와 항목으로 구성하여 작성해 줘:\n` +
    `1) 수업 개요 (수업 목표 3가지: 지식, 기능, 태도)\n` +
    `2) 단계별 교수·학습 활동 (도입-전개-정리: 시간, 교사 발문, 학생 활동, HITL 협업 포인트)\n` +
    `3) 학생의 인지적 오프로딩 방지를 위한 '비판적 발문 3가지'\n` +
    `4) 교사의 하이터치(정서 교감 및 개별 맞춤 지도) 팁 2가지`;

  return { system, user };
}

/**
 * ⑥ 학생용 AI 감사 추적(AI Audit Trail) 워크시트 생성 프롬프트
 * 4단계: 인간 독자 탐구 -> 구조적 질문(TRACI) -> AI 답변 및 피드백 태깅 -> 비판적 교정
 */
export function auditWorksheetPrompt({
  grade = '초등 5학년',
  topic = '식물의 광합성과 호흡 원리',
  concept = '식물도 밤에는 산소를 흡수하고 이산화탄소를 배출한다는 사실',
  misconception = '식물은 밤낮 상관없이 항상 산소만 배출한다는 흔한 오개념',
}) {
  const system =
    '너는 학생의 메타인지와 비판적 사고력을 길러주는 교육용 워크시트 제작 전문가야. ' +
    '학생이 AI의 답변을 무비판적으로 베끼지 않고(Cognitive Offloading 예방), ' +
    '자신의 생각을 먼저 세운 뒤 AI의 오류나 편향을 찾아 교정하는 4단계 AI 감사 추적(AI Audit Trail) 활동지를 작성해 줘.';

  const user =
    `[학생용 AI 감사 추적 활동지 구성 요청]\n\n` +
    `- 대상: ${grade}\n` +
    `- 탐구 주제: 『${topic}』\n` +
    `- 핵심 과학 개념: ${concept}\n` +
    `- 학생들이 자주 갖는 오개념: ${misconception}\n\n` +
    `[활동지 4단계 양식]:\n` +
    `1. [Step 1: 인간 독자 탐구] AI를 켜기 전에 학생이 자신의 생각과 가설을 적어보는 질문 2가지\n` +
    `2. [Step 2: 구조적 질문 (TRACI)] AI에게 날카로운 질문을 던지기 위한 프롬프트 가이드\n` +
    `3. [Step 3: 피드백 태깅 (Feedback Tagging)] AI 답변의 정확성(Correctness), 명확성(Clarity), 적절성(Tone)을 평정하는 기준 문항\n` +
    `4. [Step 4: 비판적 교정 및 안착] AI 답변 속 오개념을 교과서 지식으로 수정하여 나만의 언어로 정리하는 활동 양식`;

  return { system, user };
}

/**
 * ⑦ Level 3 HITL 피드백 검토 및 수정 보완 프롬프트 (교사-AI 협업 루프)
 * AI가 초안을 생성하고 교사가 수정 지침을 줄 때, 이를 정교하게 다듬어주는 프롬프트
 */
export function hitlFeedbackReviewPrompt(originalFeedback, teacherGuidance) {
  const system =
    '너는 교사의 교수적 권한과 교육적 판단을 철저히 존중하는 보조 AI야. ' +
    '교사가 제시한 수정 방향(지도 철학, 학생 성향 고려 등)을 최우선으로 반영하여 초안을 다듬어 줘.';

  const user =
    `[AI 생성 기존 피드백 초안]:\n"""\n${originalFeedback}\n"""\n\n` +
    `[선생님의 수정 지침 및 관점]:\n"""\n${teacherGuidance}\n"""\n\n` +
    `위 선생님의 수정 지침을 바탕으로 학생에게 전할 최종 피드백을 따뜻하고 자연스러운 문장(4~6문장)으로 완성해 줘.`;

  return { system, user };
}

/**
 * ⑧ 학생들의 피드백 태깅(Feedback Tagging) 통계 분석 프롬프트
 */
export function auditAnalyticsPrompt(taggingStats) {
  const system =
    '너는 학급 학습 진단 및 AI 리터러시 평가 전문가야. ' +
    '학생들이 AI 답변에 대해 매긴 메타 태그(정확성, 명확성, 적절성) 데이터를 분석하여 교사에게 인사이트를 제공해 줘.';

  const user =
    `우리 반 학생들의 AI 피드백 태깅(Audit Trail) 결과입니다:\n` +
    `- 총 태깅 참여 건수: ${taggingStats.totalCount || 0}건\n` +
    `- 정확성(Correctness): 우수 ${taggingStats.correctCount || 0}건, 오류 발견 ${taggingStats.errorCount || 0}건\n` +
    `- 명확성(Clarity): 이해하기 쉬움 ${taggingStats.clearCount || 0}건, 어려움 ${taggingStats.difficultCount || 0}건\n` +
    `- 적절성(Tone): 적절 ${taggingStats.toneGoodCount || 0}건, 어색/부적절 ${taggingStats.toneAwkwardCount || 0}건\n\n` +
    `교사가 다음 수업에서 지도해야 할 '학생들의 비판적 사고 경향'과 '오개념 지도 방안'을 3줄 요약해 줘.`;

  return { system, user };
}
