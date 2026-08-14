// 업스테이지(Upstage) Solar LLM 연동 — 학급 데이터 기반 AI 피드백 생성
// 감정출석부 / 빌린 책 안내 / 지구 살리기 포인트 / 운동 기록에 대한 긍정 피드백을 만든다.

const UPSTAGE_URL = 'https://api.upstage.ai/v1/chat/completions';

// Solar 챗 API 한 번 호출. 실패하면 Error를 던진다.
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
        max_tokens: 1100,
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

const MOOD_LABEL = {
  great: '아주 좋아요 😄',
  good: '좋아요 🙂',
  soso: '그저 그래요 😐',
  tired: '피곤해요 😫',
  sad: '슬퍼요 😢',
  angry: '화나요 😡',
};

const BASE_SYSTEM =
  '너는 한국 초등학교 담임 선생님을 돕는 따뜻한 학급 도우미 AI야. ' +
  '항상 한국어 존댓말로, 초등학생과 선생님이 함께 읽기 좋은 쉽고 긍정적인 말투로 답해. ' +
  '이모지를 적절히(과하지 않게) 사용하고, 비난·비교 대신 격려와 구체적인 칭찬을 해. ' +
  '답변은 마크다운 없이 짧은 문단이나 "-" 목록으로 간결하게 작성해.';

// ① 감정출석부 통계 피드백 — 반 분위기 진단 + 선생님을 위한 제안
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

// ①-b 감정 체크 직후 학생에게 보여줄 짧은 긍정 피드백 (출석 오버레이용)
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

// ①-c 감정출석부 기반 긍정 친구관계 멘트 — 서로 챙겨주는 반 분위기 만들기
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

// ② 빌린 책 안내 — 책 소개 + 읽기 포인트 + 독후활동 제안
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

// ③ 지구 살리기 포인트 피드백 — 환경 실천 칭찬 + 다음 도전 제안
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

// ④ 운동 기록 긍정 피드백 — 셔틀런·서킷 데이터 기반 (학생 개인 또는 반 전체)
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
