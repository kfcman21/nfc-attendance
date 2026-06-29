// 프론트엔드 로직
const $ = (sel) => document.querySelector(sel);

// ===== 서브경로 배포 지원 (예: kfcman.link/attend) =====
// app.js가 로드된 위치에서 앱 베이스 경로를 구한다. 루트 배포면 '/', 서브경로면 '/attend/'.
const APP_BASE = (() => {
  try {
    const src = document.currentScript && document.currentScript.src;
    return new URL('.', src || document.baseURI).pathname;
  } catch {
    return '/';
  }
})();
// 절대경로('/api/...')에 앱 베이스를 붙여 서브경로 뒤에서도 동작하게 한다. (루트 배포면 그대로)
const apiUrl = (u) => (typeof u === 'string' && u.startsWith('/') ? APP_BASE.replace(/\/$/, '') + u : u);
// fetch·EventSource를 감싸 모든 '/api/...' 호출을 자동 보정 — 개별 호출부 수정 불필요.
const _origFetch = window.fetch.bind(window);
window.fetch = (input, init) => _origFetch(typeof input === 'string' ? apiUrl(input) : input, init);
if (window.EventSource) {
  const _OrigES = window.EventSource;
  const PatchedES = function (url, cfg) {
    return new _OrigES(apiUrl(url), cfg);
  };
  PatchedES.prototype = _OrigES.prototype;
  window.EventSource = PatchedES;
}

const api = (url, opts) => fetch(url, opts).then((r) => r.json());

// 감정(오늘의 기분) 종류 — 대시보드/오버레이 공용
const MOODS = [
  { key: 'great', emoji: '😄', label: '아주 좋아요', color: '#22c55e' },
  { key: 'good', emoji: '🙂', label: '좋아요', color: '#84cc16' },
  { key: 'soso', emoji: '😐', label: '그저 그래요', color: '#eab308' },
  { key: 'tired', emoji: '😫', label: '피곤해요', color: '#f59e0b' },
  { key: 'sad', emoji: '😢', label: '슬퍼요', color: '#3b82f6' },
  { key: 'angry', emoji: '😡', label: '화나요', color: '#ef4444' },
];
const moodByKey = Object.fromEntries(MOODS.map((m) => [m.key, m]));

// 개인정보 없이 번호만 등록된 학생도 자연스럽게 표시: 이름 없으면 "○번"
function displayName(s) {
  if (!s) return '(미등록)';
  if (s.name && s.name.trim()) return s.name;
  if (s.student_no) return `${s.student_no}번`;
  return '(이름없음)';
}

// ---- 탭 전환 ----
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'students') loadStudents();
    if (btn.dataset.tab === 'records') loadRecords();
    if (btn.dataset.tab === 'dash') loadDashboard();
    if (btn.dataset.tab === 'weekly') loadWeekly();
    if (btn.dataset.tab === 'mood') loadMoodStats();
    if (btn.dataset.tab === 'points') loadPointsTab();
    if (btn.dataset.tab === 'library') loadLibrary();
    if (btn.dataset.tab === 'shuttle') loadShuttle();
    if (btn.dataset.tab === 'circuit') loadCircuit();
    if (btn.dataset.tab === 'settings') loadSettings();
    if (btn.dataset.tab === 'data') loadDataManager();
    if (['live', 'shuttle', 'circuit'].includes(btn.dataset.tab)) loadAirWeather();
    if (btn.dataset.tab === 'live') loadNeisMeal();
    // 탭에 맞는 리더기 모드로 전환 (해당 탭에서만 카드 태그를 그 용도로 처리)
    setMode(TAB_MODE[btn.dataset.tab] || 'attendance');
  });
});

const TAB_MODE = { library: 'lending', shuttle: 'shuttle', circuit: 'circuit', reset: 'lookup' };
function setMode(mode) {
  fetch('/api/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  }).catch(() => {});
}

// ---- 연결 상태 ----
function setStatus(connected, message) {
  const el = $('#status');
  el.classList.toggle('status--on', connected);
  el.classList.toggle('status--off', !connected);
  $('#status-text').textContent = connected ? '리더기 연결됨' : message || '리더기 연결 안 됨';
}

// ---- 실시간 이벤트 수신 (SSE) ----
const todayList = $('#today-list');
let todayCount = 0;

function bigcard(cls, name, sub) {
  const el = $('#bigcard');
  el.className = 'bigcard ' + cls;
  el.innerHTML = name
    ? `<div class="bigcard__name">${name}</div><div class="bigcard__sub">${sub}</div>`
    : `<div class="bigcard__hint">${sub}</div>`;
  if (cls !== 'bigcard--idle') {
    clearTimeout(bigcard._t);
    bigcard._t = setTimeout(() => {
      el.className = 'bigcard bigcard--idle';
      el.innerHTML = '<div class="bigcard__hint">카드를 리더기에 대주세요</div>';
    }, 4000);
  }
}

function onTap(ev) {
  // 출석이 아닌 모드 탭(도서/체육/카드초기화)에서는 출석 처리를 건너뜀
  if (['tab-library', 'tab-shuttle', 'tab-circuit', 'tab-reset'].some((id) => document.getElementById(id)?.classList.contains('active')))
    return;

  // 학생 등록 화면
  if ($('#tab-students').classList.contains('active')) {
    // 번호 빠른 등록 모드: 미등록 카드를 태그하면 다음 번호로 자동 등록
    if ($('#qr-on')?.checked) {
      if (ev.known) {
        showQrMsg('err', `이미 등록된 카드입니다 (${displayName(ev.student)}).`);
      } else {
        quickRegister(ev.uid);
      }
      return;
    }
    // 일반 모드: 카드 UID 자동 입력
    $('#f-card').value = ev.uid;
    $('#f-card').focus();
  }

  // 포인트 상점 화면에서 카드 인식 시 처리
  if ($('#tab-points').classList.contains('active')) {
    if (ev.known) {
      selectStudentForPoints(ev.student);
    } else {
      resetPointsScannerCard('bigcard--unknown', '미등록 카드', ev.uid + ' — 학생 관리에서 등록하세요');
      $('#point-control-box').style.display = 'none';
      activeStudentForPoints = null;
    }
    return;
  }

  if (!ev.known) {
    bigcard('bigcard--unknown', '미등록 카드', ev.uid + ' — 학생 관리에서 등록하세요');
    return;
  }
  if (ev.duplicate) {
    bigcard('bigcard--dup', displayName(ev.student), '이미 출석 처리됨');
    return;
  }
  // 정상 출석
  const t = new Date(ev.attendance.tapped_at.replace(' ', 'T')).toLocaleTimeString('ko-KR');
  const late = ev.status === 'late';
  const scoreTxt = late ? `지각 · ${t} (0점)` : `출석 완료 · ${t} (+${ev.score ?? 0}점)`;
  bigcard(late ? 'bigcard--dup' : 'bigcard--ok', displayName(ev.student), scoreTxt);
  todayCount++;
  $('#today-count').textContent = todayCount;
  const li = document.createElement('li');
  const badge = late
    ? '<span class="att-badge att-badge--late">지각</span>'
    : `<span class="att-badge att-badge--ontime">+${ev.score ?? 0}</span>`;
  li.innerHTML = `<span class="t-name">${displayName(ev.student)}</span><span class="t-time">${badge} ${t}</span>`;
  todayList.prepend(li);

  // 출석 직후 "오늘의 기분" 선택 화면 띄우기 (감정 출석부)
  if (ev.attendance?.id) showMoodPicker(ev.student, ev.attendance.id);
}

// ===== 오늘의 기분 선택 (감정 출석부) =====
let moodTimer = null;
function showMoodPicker(student, attendanceId) {
  hideToday(); // 이전 학생의 '오늘 정보'가 떠 있으면 닫기
  const overlay = $('#mood-overlay');
  $('#mood-who').textContent = `${displayName(student)}님,`;
  const box = $('#mood-buttons');
  box.innerHTML = '';
  for (const m of MOODS) {
    const b = document.createElement('button');
    b.className = 'mood-btn';
    b.innerHTML = `<span class="emoji">${m.emoji}</span><span class="label">${m.label}</span>`;
    b.addEventListener('click', () => submitMood(attendanceId, m));
    box.append(b);
  }
  overlay.classList.add('show');
  // 12초간 선택 없으면 자동으로 닫힘
  clearTimeout(moodTimer);
  moodTimer = setTimeout(hideMoodPicker, 12000);
}

function hideMoodPicker() {
  clearTimeout(moodTimer);
  $('#mood-overlay').classList.remove('show');
  $('#mood-buttons').innerHTML = '';
}

async function submitMood(attendanceId, mood) {
  fetch(`/api/attendance/${attendanceId}/mood`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mood: mood.key }),
  });
  // 감사 인사 후 닫기
  const overlay = $('#mood-overlay');
  overlay.querySelector('.overlay__box').innerHTML =
    `<div class="overlay__thanks">${mood.emoji} 기록했어요!</div>`;
  clearTimeout(moodTimer);
  moodTimer = setTimeout(() => {
    // 원래 내용 복구
    overlay.querySelector('.overlay__box').innerHTML = `
      <div class="overlay__name" id="mood-who">○○○님</div>
      <div class="overlay__title">오늘 기분이 어때요?</div>
      <div id="mood-buttons" class="mood-buttons"></div>
      <div class="overlay__skip" id="mood-skip">건너뛰기</div>`;
    overlay.classList.remove('show');
    $('#mood-skip').addEventListener('click', skipMood);
    showTodayInfo(); // 감정 기록 후 오늘의 정보 보여주기
  }, 1500);
}
// 감정 건너뛰기: 감정창 닫고 오늘 정보 표시
function skipMood() {
  hideMoodPicker();
  showTodayInfo();
}
$('#mood-skip').addEventListener('click', skipMood);

// ===== 📅 출석 후 오늘의 정보 (급식·학사일정·날씨·미세먼지) =====
let todayTimer = null;
function renderTodayContent(d) {
  const parts = [];
  if (d.meal && d.meal.items?.length) {
    parts.push(
      `<div class="ti-row"><div class="ti-ico">🍱</div><div class="ti-body"><b>오늘 급식</b>` +
        `<div class="ti-sub">${d.meal.items.join(' · ')}</div>` +
        `${d.meal.allergens?.length ? `<div class="ti-allergy">알레르기: ${d.meal.allergens.join(', ')}</div>` : ''}</div></div>`
    );
  }
  if (d.schedule && (d.schedule.off || d.schedule.event)) {
    const txt = d.schedule.off ? `🏫 ${d.schedule.off}` : d.schedule.event;
    parts.push(`<div class="ti-row"><div class="ti-ico">📆</div><div class="ti-body"><b>오늘 학사일정</b><div class="ti-sub">${txt}</div></div></div>`);
  }
  if (d.weather) {
    const w = d.weather;
    const wbits = [];
    if (w.temp != null) wbits.push(`기온 ${w.temp}°C`);
    if (w.ptyLabel && w.ptyLabel !== '맑음/흐림') wbits.push(w.ptyLabel);
    parts.push(`<div class="ti-row"><div class="ti-ico">🌡</div><div class="ti-body"><b>날씨</b><div class="ti-sub">${wbits.join(' · ') || '-'}</div></div></div>`);
    parts.push(
      `<div class="ti-row"><div class="ti-ico">😷</div><div class="ti-body"><b>미세먼지</b><div class="ti-sub">${w.pmGrade}${w.pm10 != null ? ` (PM10 ${w.pm10})` : ''}</div></div></div>`
    );
    parts.push(
      `<div class="ti-row ti-out ${w.outdoor ? 'ti-out--ok' : 'ti-out--no'}"><div class="ti-ico">${w.outdoor ? '🟢' : '🔴'}</div>` +
        `<div class="ti-body"><b>${w.outdoor ? '야외활동 좋아요!' : '실내 활동을 권해요'}</b>` +
        `${!w.outdoor && w.reasons?.length ? `<div class="ti-sub">${w.reasons.join(', ')}</div>` : ''}</div></div>`
    );
  }
  return parts.join('');
}
async function showTodayInfo() {
  let d;
  try {
    d = await api('/api/today-info');
  } catch {
    return;
  }
  const html = renderTodayContent(d);
  if (!html) return; // 켜진 연동이 없거나 표시할 정보가 없으면 띄우지 않음
  $('#today-content').innerHTML = html;
  $('#today-overlay').classList.add('show');
  clearTimeout(todayTimer);
  todayTimer = setTimeout(hideToday, 11000);
}
function hideToday() {
  clearTimeout(todayTimer);
  $('#today-overlay').classList.remove('show');
}
$('#today-close').addEventListener('click', hideToday);

function connectSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'status') {
      setStatus(ev.connected, ev.message);
      if ($('#tab-settings')?.classList.contains('active')) updateConnText(ev);
    }
    if (ev.type === 'tap') onTap(ev);
    if (ev.type === 'reset' && $('#tab-data')?.classList.contains('active')) loadDataManager();
    if (ev.type === 'lending') onLending(ev);
    if (ev.type === 'reading') renderReadingStats(ev.stats);
    if (ev.type === 'shuttle') onShuttle(ev);
    if (ev.type === 'circuit') onCircuit(ev);
    if (ev.type === 'lookup') onLookup(ev);
    if (ev.type === 'raw') onRaw(ev);
    if (ev.type === 'mood') {
      // 기분이 기록되면 열려 있는 통계 화면 갱신
      if ($('#tab-mood').classList.contains('active')) loadMoodStats();
      if ($('#tab-dash').classList.contains('active')) loadDashboard();
    }
    if (ev.type === 'points') {
      // 포인트 상점 탭이 활성화된 상태라면 리더보드 실시간 업데이트
      if ($('#tab-points').classList.contains('active')) {
        loadRanking();
        // 현재 선택된 학생의 포인트 데이터가 실시간 갱신되도록 처리
        const currentActiveId = $('#point-control-box').dataset.studentId;
        if (Number(currentActiveId) === ev.studentId) {
          $('#point-student-val').textContent = ev.points;
        }
      }
    }
  };
  es.onerror = () => setStatus(false, '서버 연결 끊김');
}

// ---- 오늘 출석 초기 로드 ----
async function loadToday() {
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
  const rows = await api('/api/attendance?date=' + today);
  todayCount = rows.length;
  $('#today-count').textContent = todayCount;
  todayList.innerHTML = '';
  for (const r of rows) {
    const t = new Date(r.tapped_at.replace(' ', 'T')).toLocaleTimeString('ko-KR');
    const li = document.createElement('li');
    const badge =
      r.status === 'late'
        ? '<span class="att-badge att-badge--late">지각</span>'
        : r.status === 'ontime'
          ? `<span class="att-badge att-badge--ontime">+${r.score ?? 0}</span>`
          : '';
    li.innerHTML = `<span class="t-name">${displayName(r)}</span><span class="t-time">${badge} ${t}</span>`;
    todayList.append(li);
  }
}

// ---- 학생 관리 ----
async function loadStudents() {
  const rows = await api('/api/students');
  $('#student-count').textContent = rows.length;
  const tbody = $('#student-rows');
  tbody.innerHTML = '';
  for (const s of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${s.student_no ?? ''}</b></td>
      <td>${s.name && s.name.trim() ? s.name : '<span class="footnote">(이름없음)</span>'}</td>
      <td>${s.grade ?? ''}</td>
      <td class="uid">${s.card_uid}</td>
      <td><button class="danger" data-id="${s.id}">삭제</button></td>`;
    tr.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`${displayName(s)} 학생을 삭제할까요?`)) return;
      await fetch('/api/students/' + s.id, { method: 'DELETE' });
      loadStudents();
    });
    tbody.append(tr);
  }
}

$('#student-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    card_uid: $('#f-card').value.trim(),
    name: $('#f-name').value.trim(),
    student_no: $('#f-no').value.trim(),
    grade: $('#f-grade').value.trim(),
  };
  const res = await fetch('/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const msg = $('#form-msg');
  if (res.ok) {
    const s = await res.json();
    msg.className = 'msg ok';
    msg.textContent = `${displayName(s)} 학생 등록 완료!`;
    e.target.reset();
    loadStudents();
  } else {
    const err = await res.json();
    msg.className = 'msg err';
    msg.textContent = err.error || '등록 실패';
  }
});

// ---- 번호 빠른 등록 모드 ----
function showQrMsg(kind, text) {
  const el = $('#qr-msg');
  if (!el) return;
  el.className = 'msg ' + (kind || '');
  el.textContent = text;
}
$('#qr-on').addEventListener('change', () => {
  $('#qr-controls').style.display = $('#qr-on').checked ? '' : 'none';
  if ($('#qr-on').checked) showQrMsg('', '카드를 태그하면 위 번호로 자동 등록됩니다.');
});
async function quickRegister(uid) {
  const nextEl = $('#qr-next');
  const no = String(nextEl.value || '').trim();
  if (!no) {
    showQrMsg('err', '먼저 다음 번호를 입력하세요.');
    return;
  }
  const res = await fetch('/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_uid: uid, student_no: no }),
  });
  if (res.ok) {
    showQrMsg('ok', `${no}번 등록 완료! 다음 카드를 태그하세요.`);
    nextEl.value = String(Number(no) + 1); // 번호 자동 증가
    loadStudents();
  } else {
    const err = await res.json();
    showQrMsg('err', err.error || '등록 실패');
  }
}

// ---- 출석 현황 ----
async function loadRecords() {
  const date = $('#rec-date').value;
  const rows = await api('/api/attendance' + (date ? '?date=' + date : ''));
  const tbody = $('#rec-rows');
  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const statusTxt =
      r.status === 'ontime'
        ? '<span class="att-badge att-badge--ontime">정시</span>'
        : r.status === 'late'
          ? '<span class="att-badge att-badge--late">지각</span>'
          : '';
    tr.innerHTML = `<td>${r.student_no ?? ''}</td><td>${displayName(r)}</td><td>${r.tapped_at}</td><td>${statusTxt}</td><td>${r.score ?? ''}</td><td class="uid">${r.card_uid}</td>`;
    tbody.append(tr);
  }
}
$('#rec-load').addEventListener('click', loadRecords);
$('#rec-export').addEventListener('click', () => {
  const date = $('#rec-date').value;
  window.location = apiUrl('/api/attendance/export' + (date ? '?date=' + date : ''));
});

// ---- 대시보드 ----
async function loadDashboard() {
  const date = $('#dash-date').value || new Date().toLocaleDateString('sv-SE');
  const d = await api('/api/dashboard?date=' + date);

  $('#s-present').textContent = d.presentCount;
  $('#s-absent').textContent = d.absentCount;
  $('#s-total').textContent = d.totalStudents;
  $('#s-rate').textContent = d.rate + '%';
  $('#s-ontime').textContent = d.ontimeCount ?? 0;
  $('#s-late').textContent = d.lateCount ?? 0;
  $('#s-score').textContent = d.todayScore ?? 0;
  $('#present-count').textContent = d.presentCount;
  $('#absent-count').textContent = d.absentCount;

  // 감정 분포
  const ms = $('#mood-summary');
  const moodKeys = Object.keys(d.moods || {});
  if (moodKeys.length === 0) {
    ms.innerHTML = '<span class="empty">아직 기록된 기분이 없어요.</span>';
  } else {
    ms.innerHTML = MOODS.filter((m) => d.moods[m.key])
      .map(
        (m) =>
          `<div class="mood-chip"><span class="emoji">${m.emoji}</span>${m.label}<span class="cnt">${d.moods[m.key]}</span></div>`
      )
      .join('');
  }

  // 최근 7일 막대 차트
  const max = Math.max(1, ...d.daily.map((x) => x.count));
  $('#chart').innerHTML = d.daily
    .map((x) => {
      const h = Math.round((x.count / max) * 100);
      const day = x.date.slice(5); // MM-DD
      return `<div class="bar-wrap"><span class="bar-val">${x.count}</span><div class="bar" style="height:${h}%"></div><span class="bar-day">${day}</span></div>`;
    })
    .join('');

  // 출석/미출석 명단
  const present = $('#present-list');
  present.innerHTML = d.present.length
    ? d.present
        .map((s) => {
          const t = new Date(s.first_tap.replace(' ', 'T')).toLocaleTimeString('ko-KR');
          const badge =
            s.status === 'late'
              ? '<span class="att-badge att-badge--late">지각</span>'
              : `<span class="att-badge att-badge--ontime">+${s.score ?? 0}</span>`;
          return `<li><span>${displayName(s)}</span><span class="nl-sub">${badge} ${t}</span></li>`;
        })
        .join('')
    : '<li class="empty">출석한 학생이 없습니다.</li>';
  const absent = $('#absent-list');
  absent.innerHTML = d.absent.length
    ? d.absent.map((s) => `<li><span>${displayName(s)}</span><span class="nl-sub">${s.grade ?? ''}</span></li>`).join('')
    : '<li class="empty">전원 출석!</li>';
}
$('#dash-load').addEventListener('click', loadDashboard);

// ---- 감정 출석부 통계 ----
async function loadMoodStats() {
  const from = $('#mood-from').value;
  const to = $('#mood-to').value;
  const qs = from && to ? `?from=${from}&to=${to}` : '';
  const d = await api('/api/mood-stats' + qs);

  // 날짜 입력이 비어 있으면 서버가 정한 기본 기간으로 채움
  $('#mood-from').value = d.from;
  $('#mood-to').value = d.to;
  $('#mood-range-info').textContent = `${d.from} ~ ${d.to}`;

  // 핵심 지표
  $('#m-weather').textContent = d.weather.emoji;
  $('#m-weather-lbl').textContent = '반 감정 날씨 · ' + d.weather.label;
  $('#m-positive').textContent = d.positiveRatio + '%';
  $('#m-score').textContent = d.score > 0 ? '+' + d.score : d.score;
  $('#m-total').textContent = d.total;

  // 감정 분포 (가로 막대)
  const dist = $('#mood-dist');
  if (!d.total) {
    dist.innerHTML = '<span class="empty" style="color:var(--muted)">이 기간에 기록된 기분이 없어요.</span>';
  } else {
    dist.innerHTML = MOODS.map((m) => {
      const c = d.byMood[m.key] || 0;
      const pct = Math.round((c / d.total) * 100);
      return `<div class="mdist-row">
        <span class="mdist-emoji">${m.emoji}</span>
        <span class="mdist-label">${m.label}</span>
        <span class="mdist-track"><span class="mdist-fill" style="width:${pct}%;background:${m.color}"></span></span>
        <span class="mdist-val"><b>${c}</b>명 · ${pct}%</span>
      </div>`;
    }).join('');
  }

  // 일별 추이 (스택 막대)
  const maxDay = Math.max(1, ...d.daily.map((x) => x.total));
  $('#mood-trend').innerHTML = d.daily
    .map((x) => {
      const h = Math.round((x.total / maxDay) * 100);
      const segs = MOODS.filter((m) => x.byMood[m.key])
        .map((m) => {
          const segH = Math.round((x.byMood[m.key] / x.total) * 100);
          return `<div class="seg" style="height:${segH}%;background:${m.color}" title="${m.label} ${x.byMood[m.key]}"></div>`;
        })
        .join('');
      return `<div class="bar-wrap"><span class="bar-val">${x.total || ''}</span><div class="stack" style="height:${h}%">${segs}</div><span class="bar-day">${x.date.slice(5)}</span></div>`;
    })
    .join('');
  $('#mood-legend').innerHTML = MOODS.map(
    (m) => `<span><i style="background:${m.color}"></i>${m.emoji} ${m.label}</span>`
  ).join('');

  // 관심이 필요한 학생
  const concern = $('#mood-concern');
  concern.innerHTML = d.concern.length
    ? d.concern
        .map((s) => {
          const detail = MOODS.filter((m) => s.byMood[m.key])
            .map((m) => `${m.emoji}${s.byMood[m.key]}`)
            .join('  ');
          return `<li><span>${s.name}</span><span class="nl-sub">${detail} · 총 ${s.total}회</span></li>`;
        })
        .join('')
    : '<li class="empty">부정적 감정을 표시한 학생이 없어요. 좋은 신호예요! 😊</li>';
}
$('#mood-load').addEventListener('click', loadMoodStats);

// ---- 테스트 버튼 ----
$('#sim-btn').addEventListener('click', () => {
  fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
});

// ---- 칭찬 포인트 비즈니스 로직 ----
let activeStudentForPoints = null; // 현재 포인트 조작을 위해 태그된 학생 객체 보관용 변수

/**
 * 포인트 상점 탭을 눌렀을 때 실행되는 초기화 함수
 */
async function loadPointsTab() {
  // 학급 포인트 랭킹 리더보드를 새로 로드합니다.
  await loadRanking();
  
  // 포인트 조작 화면을 '카드를 대기하는 기본 상태'로 리셋합니다.
  resetPointsScannerCard('bigcard--idle', '카드를 태그하면 학생 정보가 표시됩니다');
  $('#point-control-box').style.display = 'none';
  activeStudentForPoints = null;
}

/**
 * 데이터베이스의 모든 학생 목록을 가져와 포인트를 기준으로 정렬 후 랭킹판을 그립니다.
 */
async function loadRanking() {
  const students = await api('/api/students');
  // 포인트 내림차순(가장 높은 학생이 1등)으로 정렬합니다.
  students.sort((a, b) => (b.points || 0) - (a.points || 0));
  
  const tbody = $('#point-ranking-rows');
  tbody.innerHTML = '';
  
  students.forEach((s, index) => {
    const tr = document.createElement('tr');
    const rank = index + 1;
    // 1, 2, 3위는 특별한 메달 색상의 CSS 클래스를 적용합니다.
    let rankBadge = `<span class="rank-badge">${rank}</span>`;
    if (rank <= 3) {
      rankBadge = `<span class="rank-badge rank-badge--${rank}">${rank}</span>`;
    }
    
    tr.innerHTML = `
      <td style="text-align: center; vertical-align: middle;">${rankBadge}</td>
      <td style="font-weight: bold;">${displayName(s)}</td>
      <td>${s.grade || '-'}</td>
      <td style="text-align: right; padding-right: 20px;" class="points-text">${s.points || 0} P</td>
    `;
    tbody.append(tr);
  });
}

/**
 * 카드가 태그되었을 때, 해당 학생을 포인트 제어 대상 학생으로 설정합니다.
 */
function selectStudentForPoints(student) {
  activeStudentForPoints = student;
  $('#point-control-box').style.display = 'block';
  $('#point-control-box').dataset.studentId = student.id;
  $('#point-student-name').textContent = displayName(student);
  $('#point-student-detail').textContent = `${student.grade || '학년/반 미지정'} · 번호 ${student.student_no || '미지정'}`;
  $('#point-student-val').textContent = student.points || 0;

  // 포인트 인식창 상태를 녹색 성공 상태로 변환합니다.
  resetPointsScannerCard('bigcard--ok', '카드 인식 완료', `${displayName(student)} 학생의 포인트 조작이 가능합니다.`);
}

/**
 * 포인트 스캔 안내 영역의 스타일 및 텍스트를 업데이트하는 헬퍼 함수
 */
function resetPointsScannerCard(cls, title, sub = '') {
  const el = $('#point-scanner-card');
  el.className = 'bigcard ' + cls;
  if (cls === 'bigcard--idle') {
    el.innerHTML = `<div class="bigcard__hint">${title}</div>`;
  } else {
    el.innerHTML = `<div class="bigcard__name" style="font-size: 28px;">${title}</div><div class="bigcard__sub" style="font-size: 14px;">${sub}</div>`;
  }
}

/**
 * 지정된 증감치(delta) 만큼 서버에 포인트를 갱신 요청하는 함수
 */
async function updatePoints(delta) {
  if (!activeStudentForPoints) return;
  const res = await fetch(`/api/students/${activeStudentForPoints.id}/points`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta }),
  });
  if (res.ok) {
    const updated = await res.json();
    activeStudentForPoints = updated;
    $('#point-student-val').textContent = updated.points;
    // 랭킹 리스트 리렌더링
    loadRanking();
  }
}

// 각 포인트 적립/차감 버튼들에 클릭 이벤트를 추가합니다.
document.querySelectorAll('.btn-point').forEach(btn => {
  btn.addEventListener('click', () => {
    const delta = Number(btn.dataset.delta);
    updatePoints(delta);
  });
});

// ===== 📖 도서 대여 & 학급 독서 온도계 =====
async function loadLibrary() {
  const st = await api('/api/reading/stats');
  renderReadingStats(st);
  loadBooks();
}

function renderReadingStats(st) {
  if (!st) return;
  $('#thermo-fill').style.width = st.percent + '%';
  $('#thermo-count').textContent = st.totalRead;
  $('#thermo-goal').textContent = `/ ${st.goalBooks}권`;
  $('#thermo-pct').textContent = st.percent + '%';
  $('#lib-total').textContent = st.totalBooks;
  $('#lib-out').textContent = st.currentlyOut;

  const medals = ['🥇', '🥈', '🥉'];
  const rank = $('#reading-rank');
  rank.innerHTML = st.ranking.length
    ? st.ranking
        .map(
          (r, i) =>
            `<li><span><span class="rank-medal">${medals[i] || i + 1}</span>${r.name}</span><span class="nl-sub">${r.read_count}권</span></li>`
        )
        .join('')
    : '<li class="empty">아직 읽은 기록이 없어요.</li>';

  const rv = $('#recent-reviews');
  rv.innerHTML = st.recentReviews.length
    ? st.recentReviews
        .map((r) => {
          const n = r.rating || 0;
          const stars = '★'.repeat(n) + '☆'.repeat(5 - n);
          return `<li><div class="rv-top"><span class="rv-book">${r.title}</span><span>${r.student_name}</span></div>${n ? `<div style="color:#fbbf24">${stars}</div>` : ''}<div class="rv-text">${r.review}</div></li>`;
        })
        .join('')
    : '<li class="empty">아직 한 줄 평이 없어요.</li>';
}

async function loadBooks() {
  const books = await api('/api/books');
  $('#book-count').textContent = books.length;
  const tbody = $('#book-rows');
  tbody.innerHTML = '';
  for (const b of books) {
    const status = b.active_loan_id
      ? `<span style="color:var(--warn)">대여중 · ${b.borrower_name ?? ''}</span>`
      : '<span style="color:var(--ok)">대여 가능</span>';
    const returnBtn = b.active_loan_id
      ? `<button class="secondary act-return" style="padding:6px 14px;font-size:13px">반납</button> `
      : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${b.title}</td><td>${b.author ?? ''}</td><td>${status}</td><td class="uid">${b.card_uid}</td><td style="white-space:nowrap">${returnBtn}<button class="danger act-del">삭제</button></td>`;

    const retEl = tr.querySelector('.act-return');
    if (retEl)
      retEl.addEventListener('click', async () => {
        if (!confirm(`'${b.title}'을(를) 반납 처리할까요?`)) return;
        const res = await fetch(`/api/books/${b.id}/return`, { method: 'POST' });
        if (res.ok) loadLibrary();
        else alert((await res.json()).error || '반납 실패');
      });

    tr.querySelector('.act-del').addEventListener('click', async () => {
      if (!confirm(`'${b.title}' 도서를 삭제할까요?`)) return;
      await fetch('/api/books/' + b.id, { method: 'DELETE' });
      loadLibrary();
    });
    tbody.append(tr);
  }
}

// 도서 등록
$('#book-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    card_uid: $('#b-card').value.trim(),
    title: $('#b-title').value.trim(),
    author: $('#b-author').value.trim(),
  };
  const res = await fetch('/api/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const msg = $('#book-msg');
  if (res.ok) {
    msg.className = 'msg ok';
    msg.textContent = `'${body.title}' 등록 완료!`;
    e.target.reset();
    loadLibrary();
  } else {
    const err = await res.json();
    msg.className = 'msg err';
    msg.textContent = err.error || '등록 실패';
  }
});

// 대여/반납 안내 배너 + 흐름 처리
function setBanner(cls, title, sub = '') {
  const banner = $('#lending-banner');
  banner.className = 'bigcard ' + cls;
  banner.innerHTML = sub
    ? `<div class="bigcard__name">${title}</div><div class="bigcard__sub">${sub}</div>`
    : `<div class="bigcard__hint">${title}</div>`;
}
const LENDING_HINT = '① 학생 카드 → ② 도서 카드 순서로 태그하세요';

function onLending(ev) {
  switch (ev.step) {
    case 'on':
    case 'timeout':
      setBanner('bigcard--idle', ev.step === 'timeout' ? '시간 초과 — 학생 카드부터 다시 태그하세요' : LENDING_HINT);
      break;
    case 'student':
      setBanner('lending-banner--student', `${ev.student.name}님,`, '빌릴 책을 태그하세요 📚');
      break;
    case 'borrowed':
      setBanner('lending-banner--borrow', `${ev.student.name} → 『${ev.book.title}』`, '대여 완료! 📗');
      loadBooks();
      break;
    case 'returned':
      setBanner('lending-banner--return', `『${ev.book.title}』 반납 완료 📘`, ev.student ? `${ev.student.name}님 수고했어요!` : '');
      loadBooks();
      if (ev.student && ev.loan) showReviewPicker(ev.student, ev.book, ev.loan.id);
      break;
    case 'need-student':
      setBanner('lending-banner--warn', '먼저 학생 카드를 태그하세요', `『${ev.book.title}』`);
      break;
    case 'error':
      setBanner('lending-banner--err', '대여할 수 없어요', ev.message || '');
      break;
    case 'unknown':
      // 미등록 카드 → 도서 등록 칸에 자동 입력
      $('#b-card').value = ev.uid;
      setBanner('lending-banner--warn', '미등록 카드', `${ev.uid} — 아래에서 도서로 등록하세요`);
      break;
  }
  if (['borrowed', 'returned', 'error', 'unknown', 'need-student'].includes(ev.step)) {
    clearTimeout(onLending._t);
    onLending._t = setTimeout(() => {
      if ($('#tab-library').classList.contains('active')) setBanner('bigcard--idle', LENDING_HINT);
    }, 4500);
  }
}

// 반납 후 별점 & 한 줄 평 (개인 독서 기록장)
let reviewState = { loanId: null, rating: 0 };
function showReviewPicker(student, book, loanId) {
  reviewState = { loanId, rating: 0 };
  $('#review-who').textContent = `${student.name}님,`;
  $('#review-book').textContent = `『${book.title}』 어땠어요?`;
  $('#review-text').value = '';
  renderStars(0);
  $('#review-overlay').classList.add('show');
}
function renderStars(n) {
  const wrap = $('#stars');
  wrap.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('span');
    s.className = 'star' + (i <= n ? ' on' : '');
    s.textContent = '★';
    s.addEventListener('click', () => {
      reviewState.rating = i;
      renderStars(i);
    });
    wrap.append(s);
  }
}
function hideReview() {
  $('#review-overlay').classList.remove('show');
}
$('#review-save').addEventListener('click', async () => {
  if (reviewState.loanId) {
    await fetch(`/api/loans/${reviewState.loanId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: reviewState.rating || null, review: $('#review-text').value.trim() }),
    });
  }
  hideReview();
});
$('#review-skip').addEventListener('click', hideReview);

// ===== 공용: 소리 / 음성 / 배너 / 축하 =====
let audioCtx = null;
function beep(freq = 800, dur = 0.12) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g);
    g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}
function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}
function setBannerEl(sel, cls, title, sub = '') {
  const b = $(sel);
  b.className = 'bigcard ' + cls;
  b.innerHTML = sub
    ? `<div class="bigcard__name">${title}</div><div class="bigcard__sub">${sub}</div>`
    : `<div class="bigcard__hint">${title}</div>`;
}
function celebrate(emoji, title, sub = '') {
  $('#celebrate-emoji').textContent = emoji;
  $('#celebrate-title').textContent = title;
  $('#celebrate-sub').textContent = sub;
  const o = $('#celebrate-overlay');
  o.classList.add('show');
  beep(880, 0.15);
  setTimeout(() => beep(1175, 0.22), 160);
  speak('신기록!');
  clearTimeout(celebrate._t);
  celebrate._t = setTimeout(() => o.classList.remove('show'), 3000);
}

// ===== 🏃 셔틀런 =====
const shuttleBoard = new Map(); // studentId -> {studentId,name,laps,best,isBest}
function renderShuttleBoard() {
  const el = $('#shuttle-board');
  if (shuttleBoard.size === 0) {
    el.innerHTML = '<div class="empty" style="color:var(--muted)">아직 달린 학생이 없어요. 카드를 태그해 시작하세요!</div>';
    return;
  }
  el.innerHTML = '';
  for (const v of shuttleBoard.values()) {
    const card = document.createElement('div');
    card.className = 'runcard' + (v.isBest ? ' best' : '');
    card.id = 'run-' + v.studentId;
    card.innerHTML = `<div class="runcard__name">${v.name}</div><div class="runcard__num">${v.laps}</div><div class="runcard__sub">최고 ${v.best || 0}</div>`;
    el.append(card);
  }
}
function onShuttle(ev) {
  if (ev.step === 'lap') {
    const cur = shuttleBoard.get(ev.student.id) || { studentId: ev.student.id, name: ev.student.name };
    cur.laps = ev.laps;
    cur.best = ev.best;
    cur.isBest = ev.isNewBest;
    shuttleBoard.set(ev.student.id, cur);
    renderShuttleBoard();
    const card = $('#run-' + ev.student.id);
    if (card) {
      card.classList.remove('pulse');
      void card.offsetWidth;
      card.classList.add('pulse');
    }
    beep(ev.isNewBest ? 1175 : 640, 0.1);
    setBannerEl('#shuttle-banner', 'lending-banner--student', ev.student.name, `${ev.laps}회 왕복!`);
    if (ev.isNewBest) celebrate('🏃', '개인 신기록!', `${ev.student.name} · ${ev.laps}회`);
  } else if (ev.step === 'unknown') {
    setBannerEl('#shuttle-banner', 'lending-banner--warn', '미등록 카드', '학생 관리에서 먼저 등록하세요');
  } else if (ev.step === 'reset' || ev.step === 'saved') {
    shuttleBoard.clear();
    renderShuttleBoard();
    loadShuttleRank();
  }
}
async function loadShuttle() {
  const live = await api('/api/shuttle/live');
  shuttleBoard.clear();
  for (const v of live) shuttleBoard.set(v.studentId, { studentId: v.studentId, name: v.name, laps: v.laps, best: 0 });
  renderShuttleBoard();
  loadShuttleRank();
}
async function loadShuttleRank() {
  const rows = await api('/api/shuttle/leaderboard');
  const medals = ['🥇', '🥈', '🥉'];
  $('#shuttle-rank').innerHTML = rows.length
    ? rows
        .map(
          (r, i) =>
            `<li><span><span class="rank-medal">${medals[i] || i + 1}</span>${r.name}</span><span class="nl-sub">최고 ${r.best}회 · ${r.attempts}회 도전</span></li>`
        )
        .join('')
    : '<li class="empty">아직 기록이 없어요.</li>';
}
$('#shuttle-save').addEventListener('click', async () => {
  const res = await api('/api/shuttle/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const news = res.filter((r) => r.isNewBest);
  alert(`기록 저장 완료! ${res.length}명 저장${news.length ? `\n🎉 신기록: ${news.map((r) => r.name).join(', ')}` : ''}`);
});
$('#shuttle-reset').addEventListener('click', () => {
  if (confirm('현재 진행 중인 왕복 수를 모두 초기화할까요?'))
    fetch('/api/shuttle/reset', { method: 'POST' });
});

// 페이스 가이드 (PACER 근사: 레벨이 오를수록 신호 간격이 짧아짐)
let paceTimer = null,
  paceLevel = 0,
  paceBeeps = 0;
const paceInterval = (lv) => Math.max(3, 9 - (lv - 1) * 0.5); // 초
function startPace() {
  stopPace(false);
  paceLevel = 1;
  paceBeeps = 0;
  $('#pace-toggle').textContent = '⏸ 페이스 가이드 정지';
  speak('레벨 1 시작');
  $('#pace-info').textContent = `레벨 1 · 신호 간격 ${paceInterval(1).toFixed(1)}초`;
  schedulePace();
}
function schedulePace() {
  paceTimer = setTimeout(() => {
    beep(800, 0.1);
    paceBeeps++;
    if (paceBeeps >= 8) {
      paceLevel++;
      paceBeeps = 0;
      beep(1175, 0.25);
      speak('레벨 ' + paceLevel);
    }
    $('#pace-info').textContent = `레벨 ${paceLevel} · 신호 간격 ${paceInterval(paceLevel).toFixed(1)}초`;
    schedulePace();
  }, paceInterval(paceLevel) * 1000);
}
function stopPace(updateBtn = true) {
  if (paceTimer) clearTimeout(paceTimer);
  paceTimer = null;
  if (updateBtn) {
    $('#pace-toggle').textContent = '▶ 페이스 가이드 시작';
    $('#pace-info').textContent = '정지됨';
  }
}
$('#pace-toggle').addEventListener('click', () => (paceTimer ? stopPace() : startPace()));

// ===== 🏋️ 서킷 트레이닝 =====
const circuitBoard = new Map(); // studentId -> {studentId,name,stationName,startMs}
let circuitTick = null;
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function renderCircuitBoard() {
  const el = $('#circuit-active');
  if (circuitBoard.size === 0) {
    el.innerHTML = '<div class="empty" style="color:var(--muted)">진행 중인 운동이 없습니다.</div>';
    if (circuitTick) {
      clearInterval(circuitTick);
      circuitTick = null;
    }
    return;
  }
  el.innerHTML = '';
  for (const v of circuitBoard.values()) {
    const sec = Math.floor((Date.now() - v.startMs) / 1000);
    const card = document.createElement('div');
    card.className = 'runcard';
    card.id = 'cir-' + v.studentId;
    card.innerHTML = `<div class="runcard__name">${v.name}</div><div class="runcard__sub">${v.stationName}</div><div class="runcard__timer">${fmtTime(sec)}</div>`;
    el.append(card);
  }
  if (!circuitTick) {
    circuitTick = setInterval(() => {
      for (const v of circuitBoard.values()) {
        const el2 = $('#cir-' + v.studentId);
        if (el2) el2.querySelector('.runcard__timer').textContent = fmtTime(Math.floor((Date.now() - v.startMs) / 1000));
      }
    }, 1000);
  }
}
function onCircuit(ev) {
  switch (ev.step) {
    case 'student':
      setBannerEl('#circuit-banner', 'lending-banner--student', `${ev.student.name}님`, '운동할 스테이션 카드를 태그하세요');
      break;
    case 'started':
      circuitBoard.set(ev.student.id, { studentId: ev.student.id, name: ev.student.name, stationName: ev.station.name, startMs: Date.now() });
      renderCircuitBoard();
      setBannerEl('#circuit-banner', 'lending-banner--borrow', `${ev.student.name} · ${ev.station.name}`, '운동 시작! ⏱️');
      beep(660, 0.12);
      break;
    case 'finished':
      circuitBoard.delete(ev.student.id);
      renderCircuitBoard();
      setBannerEl('#circuit-banner', 'lending-banner--return', `${ev.student.name} · ${ev.station.name}`, `${ev.durationSec}초 기록!`);
      beep(880, 0.15);
      if (ev.isNewBest) celebrate('🏋️', '개인 신기록!', `${ev.student.name} · ${ev.station.name} ${ev.durationSec}초`);
      if ($('#growth-student').value === String(ev.student.id)) loadGrowth(ev.student.id);
      break;
    case 'need-student':
      setBannerEl('#circuit-banner', 'lending-banner--warn', '먼저 학생 카드를 태그하세요', ev.station.name);
      break;
    case 'unknown':
      $('#st-card').value = ev.uid;
      setBannerEl('#circuit-banner', 'lending-banner--warn', '미등록 카드', `${ev.uid} — 아래에서 스테이션으로 등록하세요`);
      break;
    case 'timeout':
      setBannerEl('#circuit-banner', 'bigcard--idle', '① 학생 카드 → ② 스테이션 카드');
      break;
  }
  if (['started', 'finished', 'need-student', 'unknown'].includes(ev.step)) {
    clearTimeout(onCircuit._t);
    onCircuit._t = setTimeout(() => {
      if ($('#tab-circuit').classList.contains('active'))
        setBannerEl('#circuit-banner', 'bigcard--idle', '시작: ① 학생 카드 → ② 스테이션 카드  /  종료: ② 스테이션 카드만 태그');
    }, 4500);
  }
}
async function loadCircuit() {
  loadStations();
  const students = await api('/api/students');
  const sel = $('#growth-student');
  const keep = sel.value;
  sel.innerHTML = '<option value="">학생을 선택하세요</option>' + students.map((s) => `<option value="${s.id}">${displayName(s)}</option>`).join('');
  sel.value = keep;
  renderCircuitBoard();
}
async function loadStations() {
  const rows = await api('/api/stations');
  const tbody = $('#station-rows');
  tbody.innerHTML = '';
  for (const st of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${st.name}</td><td class="uid">${st.card_uid}</td><td><button class="danger">삭제</button></td>`;
    tr.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`'${st.name}' 스테이션을 삭제할까요?`)) return;
      await fetch('/api/stations/' + st.id, { method: 'DELETE' });
      loadStations();
    });
    tbody.append(tr);
  }
}
$('#station-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { card_uid: $('#st-card').value.trim(), name: $('#st-name').value.trim() };
  const res = await fetch('/api/stations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const msg = $('#station-msg');
  if (res.ok) {
    msg.className = 'msg ok';
    msg.textContent = `'${body.name}' 등록 완료!`;
    e.target.reset();
    loadStations();
  } else {
    const err = await res.json();
    msg.className = 'msg err';
    msg.textContent = err.error || '등록 실패';
  }
});
$('#growth-student').addEventListener('change', () => loadGrowth($('#growth-student').value));
async function loadGrowth(studentId) {
  const chart = $('#growth-chart');
  if (!studentId) {
    chart.innerHTML = '<span class="footnote">학생을 선택하면 종목별 성장 그래프가 표시됩니다.</span>';
    return;
  }
  const data = await api('/api/circuit/growth/' + studentId);
  if (!data.length) {
    chart.innerHTML = '<span class="footnote">아직 측정 기록이 없어요.</span>';
    return;
  }
  chart.innerHTML = data
    .map((st) => {
      const max = Math.max(...st.points.map((p) => p.sec), 1);
      const bars = st.points
        .map((p) => {
          const h = Math.round((p.sec / max) * 100);
          return `<div class="gbar-wrap"><span class="gval">${p.sec}s</span><div class="gbar" style="height:${h}%"></div><span class="gdate">${p.at.slice(5, 10)}</span></div>`;
        })
        .join('');
      return `<div class="growth-station"><h3>${st.name} <span class="footnote">(${st.points.length}회 측정)</span></h3><div class="growth-line">${bars}</div></div>`;
    })
    .join('');
}

// ===== 🗑 카드 초기화 =====
const KIND_LABEL = { student: '학생', book: '도서', station: '스테이션' };
const KIND_API = { student: 'students', book: 'books', station: 'stations' };
let resetTarget = null; // { kind, item, uid }

function onLookup(ev) {
  const result = $('#reset-result');
  if (ev.kind === 'none') {
    resetTarget = null;
    result.style.display = 'none';
    setBannerEl('#reset-banner', 'lending-banner--warn', '미등록 카드', `${ev.uid} — 초기화할 등록 내용이 없어요`);
    return;
  }
  resetTarget = { kind: ev.kind, item: ev.item, uid: ev.uid };
  const name = ev.item.name ?? ev.item.title ?? '(이름 없음)';
  setBannerEl('#reset-banner', 'lending-banner--student', `${KIND_LABEL[ev.kind]} 카드`, name);
  $('#reset-kind').textContent = KIND_LABEL[ev.kind];
  $('#reset-name').textContent = name;
  $('#reset-uid').textContent = ev.uid;
  $('#reset-note').textContent = `이 카드를 초기화하면 위 ${KIND_LABEL[ev.kind]} 등록이 삭제됩니다.`;
  result.style.display = 'block';
}

function resetClear() {
  resetTarget = null;
  $('#reset-result').style.display = 'none';
  setBannerEl('#reset-banner', 'bigcard--idle', '초기화할 카드를 리더기에 태그하세요');
}

$('#reset-do').addEventListener('click', async () => {
  if (!resetTarget) return;
  const name = resetTarget.item.name ?? resetTarget.item.title;
  if (!confirm(`'${name}' (${KIND_LABEL[resetTarget.kind]}) 카드를 초기화할까요?\n등록이 삭제되어 다시 등록할 수 있게 됩니다.`)) return;
  await fetch(`/api/${KIND_API[resetTarget.kind]}/${resetTarget.item.id}`, { method: 'DELETE' });
  setBannerEl('#reset-banner', 'lending-banner--return', '초기화 완료 ✅', `${name} 카드를 다시 등록할 수 있어요`);
  $('#reset-result').style.display = 'none';
  resetTarget = null;
  setTimeout(() => {
    if ($('#tab-reset').classList.contains('active')) setBannerEl('#reset-banner', 'bigcard--idle', '초기화할 카드를 리더기에 태그하세요');
  }, 3500);
});
$('#reset-cancel').addEventListener('click', resetClear);

// ===== ⚙ 설정·진단 =====
async function loadSettings() {
  const cfg = await api('/api/serial-config');
  $('#set-auto').checked = cfg.autoDetect;
  $('#set-baud').value = String(cfg.baudRate);
  updateConnText(cfg.active);
  togglePortWrap();
  await loadScoringConfig();
  await loadSheetsConfig();
  await loadPublicConfig();
  await loadNeisConfig();
  await loadUiConfig();
  await loadPorts(cfg.port);
}

// ---- 📗 Google Sheets 동기화 ----
function showSheetsMsg(kind, text) {
  const el = $('#sheets-msg');
  el.className = 'msg ' + (kind || '');
  el.textContent = text;
}
function renderSheetsStatus(cfg) {
  const el = $('#sheets-status');
  if (!el) return;
  let s = cfg.enabled ? '✅ 자동 동기화 켜짐' : '⏸ 자동 동기화 꺼짐';
  if (cfg.lastSync) s += ` · 최근 동기화 ${new Date(cfg.lastSync).toLocaleString('ko-KR')}`;
  if (cfg.lastError) s += ` · ⚠ 최근 오류: ${cfg.lastError}`;
  el.textContent = s;
}
async function loadSheetsConfig() {
  const cfg = await api('/api/sheets-config');
  $('#sheets-url').value = cfg.url || '';
  $('#sheets-on').checked = !!cfg.enabled;
  renderSheetsStatus(cfg);
}
async function saveSheetsConfig() {
  const body = { url: $('#sheets-url').value.trim(), enabled: $('#sheets-on').checked };
  const res = await fetch('/api/sheets-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}
$('#sheets-save').addEventListener('click', async () => {
  showSheetsMsg('', '저장 중...');
  const ok = await saveSheetsConfig();
  showSheetsMsg(ok ? 'ok' : 'err', ok ? '저장했습니다.' : '저장 실패');
  loadSheetsConfig();
});
$('#sheets-on').addEventListener('change', async () => {
  await saveSheetsConfig();
  loadSheetsConfig();
});
$('#sheets-test').addEventListener('click', async () => {
  await saveSheetsConfig(); // 현재 입력한 URL을 먼저 저장하고 테스트
  showSheetsMsg('', '연결 테스트 중...');
  const res = await fetch('/api/sheets/test', { method: 'POST' });
  const d = await res.json().catch(() => ({}));
  if (res.ok && d.ok) showSheetsMsg('ok', '연결 성공! 구글 시트와 통신됩니다. 👍');
  else showSheetsMsg('err', '연결 실패: ' + (d.error || '응답 없음') + ' (URL과 "모든 사용자" 배포를 확인하세요)');
});
$('#sheets-sync').addEventListener('click', async () => {
  await saveSheetsConfig();
  showSheetsMsg('', '동기화 중...');
  const res = await fetch('/api/sheets/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const d = await res.json().catch(() => ({}));
  if (res.ok && d.ok) showSheetsMsg('ok', `동기화 완료! ${d.from}~${d.to} 주간 점수 ${d.count}명 전송.`);
  else showSheetsMsg('err', '동기화 실패: ' + (d.error || '응답 없음'));
  loadSheetsConfig();
});

// ---- 🌐 공공데이터(공휴일 · 미세먼지 · 날씨) ----
async function loadPublicConfig() {
  const cfg = await api('/api/public-config');
  $('#pd-key').value = cfg.serviceKey || '';
  $('#pd-holiday-key').value = cfg.holidays?.key || '';
  $('#pd-air-key').value = cfg.air?.key || '';
  $('#pd-weather-key').value = cfg.weather?.key || '';
  $('#pd-holidays').checked = !!cfg.holidays?.enabled;
  $('#pd-air').checked = !!cfg.airweather?.enabled;
  $('#pd-sido').value = cfg.airweather?.sido ?? '서울';
  $('#pd-nx').value = cfg.airweather?.nx ?? 60;
  $('#pd-ny').value = cfg.airweather?.ny ?? 127;
}
async function savePublicConfig() {
  const body = {
    serviceKey: $('#pd-key').value.trim(),
    holidayKey: $('#pd-holiday-key').value.trim(),
    airApiKey: $('#pd-air-key').value.trim(),
    weatherKey: $('#pd-weather-key').value.trim(),
    holidaysEnabled: $('#pd-holidays').checked,
    airEnabled: $('#pd-air').checked,
    sido: $('#pd-sido').value.trim(),
    nx: $('#pd-nx').value,
    ny: $('#pd-ny').value,
  };
  const res = await fetch('/api/public-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}
function showPdMsg(kind, text) {
  const el = $('#pd-msg');
  el.className = 'msg ' + (kind || '');
  el.textContent = text;
}
$('#pd-save').addEventListener('click', async () => {
  showPdMsg('', '저장 중...');
  const ok = await savePublicConfig();
  showPdMsg(ok ? 'ok' : 'err', ok ? '저장했습니다. (공휴일은 주간 점수에 자동 반영됩니다)' : '저장 실패');
  airwxCache = null; // 위젯 캐시 무효화
  loadAirWeather(true);
});
$('#pd-holidays').addEventListener('change', () => savePublicConfig());
$('#pd-air').addEventListener('change', async () => {
  await savePublicConfig();
  airwxCache = null;
  loadAirWeather(true);
});
$('#pd-test').addEventListener('click', async () => {
  await savePublicConfig();
  const prev = $('#pd-preview');
  showPdMsg('', '조회 중...');
  try {
    const d = await api('/api/air-weather');
    if (d.error) {
      showPdMsg('err', '조회 실패: ' + d.error);
      return;
    }
    showPdMsg('ok', '조회 성공!');
    const parts = [];
    if (d.temp != null) parts.push(`기온 ${d.temp}°C`);
    if (d.ptyLabel) parts.push(`강수 ${d.ptyLabel}`);
    parts.push(`미세먼지 ${d.pmGrade}${d.pm10 != null ? ` (PM10 ${d.pm10}, PM2.5 ${d.pm25 ?? '-'})` : ''}`);
    parts.push(d.outdoor ? '🟢 야외활동 좋음' : `🔴 실내 권장 (${d.reasons.join(', ')})`);
    if (d.station) parts.push(`측정소 ${d.station}`);
    if (d.airError) parts.push(`⚠ 미세먼지 오류: ${d.airError}`);
    if (d.weatherError) parts.push(`⚠ 날씨 오류: ${d.weatherError}`);
    prev.textContent = parts.join(' · ');
  } catch (e) {
    showPdMsg('err', '조회 실패: ' + e.message);
  }
});

// 미세먼지·날씨 위젯 (실시간 출석 / 셔틀런 / 서킷 상단)
let airwxCache = null;
let airwxAt = 0;
let airwxConfig = null;
function renderAirwx(d) {
  const nodes = document.querySelectorAll('[data-airwx]');
  const tempStr = d.temp != null ? `${d.temp}°C` : '';
  const sky = d.ptyLabel && d.ptyLabel !== '맑음/흐림' ? d.ptyLabel + ' ' : '';
  const pm = `미세먼지 <b>${d.pmGrade}</b>${d.pm10 != null ? ` (PM10 ${d.pm10})` : ''}`;
  const badge = d.outdoor
    ? '<span class="airwx__ok">🟢 야외활동 좋아요</span>'
    : `<span class="airwx__no">🔴 실내 권장 · ${(d.reasons || []).join(', ')}</span>`;
  const html = `<span class="airwx__main">🌡 ${tempStr} ${sky}· ${pm}</span>${badge}`;
  nodes.forEach((n) => {
    n.hidden = false;
    n.innerHTML = html;
  });
}
async function loadAirWeather(force = false) {
  const nodes = document.querySelectorAll('[data-airwx]');
  if (!nodes.length) return;
  try {
    if (!airwxConfig || force) airwxConfig = await api('/api/public-config');
  } catch {
    return;
  }
  if (!airwxConfig.airweather?.enabled || !(airwxConfig.hasAirKey || airwxConfig.hasWeatherKey)) {
    nodes.forEach((n) => (n.hidden = true));
    return;
  }
  if (!force && airwxCache && Date.now() - airwxAt < 600000) {
    renderAirwx(airwxCache);
    return;
  }
  try {
    const d = await api('/api/air-weather');
    if (d.error) return;
    airwxCache = d;
    airwxAt = Date.now();
    renderAirwx(d);
  } catch {}
}

// ---- 🏫 NEIS (급식 · 학사일정) ----
function showNeisMsg(kind, text) {
  const el = $('#neis-msg');
  el.className = 'msg ' + (kind || '');
  el.textContent = text;
}
async function loadNeisConfig() {
  const cfg = await api('/api/neis-config');
  $('#neis-key').value = cfg.key || '';
  $('#neis-atpt').value = cfg.atptCode || '';
  $('#neis-code').value = cfg.schoolCode || '';
  $('#neis-name').value = cfg.schoolName || '';
  $('#neis-meal-on').checked = !!cfg.meal?.enabled;
  $('#neis-sched-on').checked = !!cfg.schedule?.enabled;
  $('#neis-current').textContent = cfg.schoolName
    ? `현재 학교: ${cfg.schoolName} (교육청 ${cfg.atptCode} · 학교 ${cfg.schoolCode})`
    : '학교가 아직 설정되지 않았습니다. 학교명을 검색해 선택하세요.';
}
async function saveNeisConfig() {
  const body = {
    key: $('#neis-key').value.trim(),
    atptCode: $('#neis-atpt').value.trim(),
    schoolCode: $('#neis-code').value.trim(),
    schoolName: $('#neis-name').value.trim(),
    mealEnabled: $('#neis-meal-on').checked,
    scheduleEnabled: $('#neis-sched-on').checked,
  };
  const res = await fetch('/api/neis-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}
$('#neis-search-btn').addEventListener('click', async () => {
  const name = $('#neis-school').value.trim();
  if (!name) return showNeisMsg('err', '학교명을 입력하세요.');
  await saveNeisConfig(); // 키 먼저 저장
  const sel = $('#neis-result');
  sel.innerHTML = '<option>검색 중...</option>';
  try {
    const rows = await api('/api/neis/school-search?name=' + encodeURIComponent(name));
    if (rows.error) {
      showNeisMsg('err', '검색 실패: ' + rows.error);
      sel.innerHTML = '';
      return;
    }
    if (!rows.length) {
      sel.innerHTML = '<option value="">결과 없음</option>';
      showNeisMsg('', '검색 결과가 없습니다. 학교명을 정확히 입력해 보세요.');
      return;
    }
    sel.innerHTML = rows
      .map((r) => `<option value="${r.atptCode}|${r.schoolCode}|${r.name}">${r.name} (${r.kind || ''}${r.addr ? ' · ' + r.addr : ''})</option>`)
      .join('');
    showNeisMsg('ok', `${rows.length}개 학교를 찾았습니다. 우리 학교를 고르고 [이 학교로 설정]을 누르세요.`);
  } catch (e) {
    sel.innerHTML = '';
    showNeisMsg('err', '검색 실패: ' + e.message);
  }
});
$('#neis-pick').addEventListener('click', async () => {
  const v = $('#neis-result').value;
  if (!v) return;
  const [atptCode, schoolCode, name] = v.split('|');
  $('#neis-atpt').value = atptCode;
  $('#neis-code').value = schoolCode;
  $('#neis-name').value = name;
  await saveNeisConfig();
  await loadNeisConfig();
  showNeisMsg('ok', `${name} 학교로 설정했습니다.`);
});
const showNeisKeyTestMsg = (kind, text) => {
  const el = $('#neis-key-test-msg');
  if (!el) return;
  el.style.display = 'block';
  el.className = 'msg ' + (kind || '');
  el.textContent = text;
};

$('#neis-key-test').addEventListener('click', async () => {
  const key = $('#neis-key').value.trim();
  if (!key) return showNeisKeyTestMsg('err', '인증키를 입력한 뒤 테스트해 주세요.');
  showNeisKeyTestMsg('', '인증키 유효성 확인 중...');
  try {
    const res = await fetch('/api/neis/test-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.ok) {
      showNeisKeyTestMsg('ok', d.message || '인증키가 유효하며 정상 통신됩니다. 👍');
    } else {
      showNeisKeyTestMsg('err', '검증 실패: ' + (d.error || '알 수 없는 오류'));
    }
  } catch (e) {
    showNeisKeyTestMsg('err', '검증 오류: ' + e.message);
  }
});
$('#neis-save').addEventListener('click', async () => {
  const ok = await saveNeisConfig();
  showNeisMsg(ok ? 'ok' : 'err', ok ? '저장했습니다.' : '저장 실패');
  neisMealCache = null;
  loadNeisMeal();
  neisSchedCache = null;
  loadNeisSchedule();
});

// ---- 🛠 화면·디버그 (개발자도구 자동 표시) ----
async function loadUiConfig() {
  try {
    const cfg = await api('/api/ui-config');
    $('#ui-devtools-on').checked = !!cfg.devtools;
  } catch {}
}
$('#ui-devtools-on')?.addEventListener('change', async () => {
  const el = $('#ui-msg');
  try {
    const res = await fetch('/api/ui-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devtools: $('#ui-devtools-on').checked }),
    });
    const ok = res.ok;
    if (el) {
      el.className = 'msg ok';
      el.textContent = ok
        ? `개발자도구 자동 표시를 ${$('#ui-devtools-on').checked ? '켰' : '껐'}습니다. (다음 실행부터 적용)`
        : '저장 실패';
    }
  } catch {
    if (el) {
      el.className = 'msg err';
      el.textContent = '저장 실패';
    }
  }
});
$('#neis-meal-on').addEventListener('change', async () => {
  await saveNeisConfig();
  neisMealCache = null;
  loadNeisMeal();
});
$('#neis-sched-on').addEventListener('change', async () => {
  await saveNeisConfig();
  neisSchedCache = null;
  loadNeisSchedule();
});
$('#neis-test').addEventListener('click', async () => {
  await saveNeisConfig();
  showNeisMsg('', '급식 조회 중...');
  try {
    const d = await api('/api/neis/meal');
    if (d.error) return showNeisMsg('err', '조회 실패: ' + d.error);
    if (!d.meals?.length) return showNeisMsg('ok', `${d.date}: 급식 정보가 없습니다(주말·방학 등).`);
    showNeisMsg('ok', '조회 성공!');
    $('#neis-preview').innerHTML = d.meals
      .map((m) => `<b>${m.type}</b> ${m.dishes.map((x) => x.name).join(', ')}${m.allergens.length ? ` · 알레르기: ${m.allergens.join(', ')}` : ''}`)
      .join('<br>');
  } catch (e) {
    showNeisMsg('err', '조회 실패: ' + e.message);
  }
});

// 실시간 출석 화면의 오늘 급식 위젯
let neisMealCache = null;
let neisMealAt = 0;
async function loadNeisMeal(force = false) {
  const el = $('#neis-meal');
  if (!el) return;
  let cfg;
  try {
    cfg = await api('/api/neis-config');
  } catch {
    return;
  }
  if (!cfg.meal?.enabled || !cfg.hasKey || !cfg.schoolCode) {
    el.hidden = true;
    return;
  }
  if (!force && neisMealCache && Date.now() - neisMealAt < 1800000) {
    renderNeisMeal(neisMealCache);
    return;
  }
  try {
    const d = await api('/api/neis/meal');
    if (d.error) {
      el.hidden = true;
      return;
    }
    neisMealCache = d;
    neisMealAt = Date.now();
    renderNeisMeal(d);
  } catch {
    el.hidden = true;
  }
}
function renderNeisMeal(d) {
  const el = $('#neis-meal');
  const lunch = (d.meals || []).find((m) => /중식/.test(m.type)) || (d.meals || [])[0];
  if (!lunch) {
    el.hidden = true;
    return;
  }
  const menu = lunch.dishes.map((x) => x.name).join(' · ');
  const allergy = lunch.allergens.length
    ? `<div class="neis-meal__allergy">알레르기: ${lunch.allergens.join(', ')}</div>`
    : '';
  el.hidden = false;
  el.innerHTML =
    `<div class="neis-meal__title">🍱 오늘 급식 <span class="footnote">${lunch.type}${lunch.calorie ? ' · ' + lunch.calorie : ''}</span></div>` +
    `<div class="neis-meal__menu">${menu}</div>${allergy}`;
}

// 실시간 출석 화면의 학사일정 위젯 (오늘 + 다가오는 행사)
let neisSchedCache = null;
let neisSchedAt = 0;
async function loadNeisSchedule(force = false) {
  const el = $('#neis-sched');
  if (!el) return;
  let cfg;
  try {
    cfg = await api('/api/neis-config');
  } catch {
    return;
  }
  if (!cfg.schedule?.enabled || !cfg.hasKey || !cfg.schoolCode) {
    el.hidden = true;
    return;
  }
  if (!force && neisSchedCache && Date.now() - neisSchedAt < 1800000) {
    renderNeisSchedule(neisSchedCache);
    return;
  }
  try {
    const d = await api('/api/neis/schedule');
    if (d.error) {
      el.hidden = true;
      return;
    }
    neisSchedCache = d;
    neisSchedAt = Date.now();
    renderNeisSchedule(d);
  } catch {
    el.hidden = true;
  }
}
function renderNeisSchedule(d) {
  const el = $('#neis-sched');
  const today = d.today ? `<div class="neis-sched__today">📌 오늘: ${d.today}</div>` : '';
  const upcoming = (d.upcoming || []).length
    ? `<div class="neis-sched__list">${d.upcoming
        .map((e) => `${e.date.slice(5).replace('-', '/')} ${e.name}`)
        .join(' · ')}</div>`
    : '';
  if (!today && !upcoming) {
    // 오늘도 행사 없고 다가오는 행사도 없으면 숨김
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML =
    `<div class="neis-sched__title">📆 학사일정${d.today ? '' : ' <span class="footnote">다가오는 일정</span>'}</div>` +
    today +
    (today && upcoming ? '<div class="neis-sched__list" style="margin-top:2px">다가오는 일정</div>' : '') +
    upcoming;
}

// ---- 출석 점수(정시/지각) 설정 ----
async function loadScoringConfig() {
  const sc = await api('/api/scoring-config');
  $('#score-cutoff').value = sc.onTimeBy || '09:00';
  $('#score-full').value = sc.fullScore ?? 10;
}
$('#score-apply').addEventListener('click', async () => {
  const body = { onTimeBy: $('#score-cutoff').value, fullScore: Number($('#score-full').value) };
  const msg = $('#score-msg');
  msg.className = 'msg';
  msg.textContent = '저장 중...';
  const res = await fetch('/api/scoring-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const sc = await res.json();
    msg.className = 'msg ok';
    msg.textContent = `저장했습니다 — 마감 ${sc.onTimeBy} 이전 = 만점(${sc.fullScore}점), 이후 = 지각(0점)`;
  } else {
    msg.className = 'msg err';
    msg.textContent = '저장 실패';
  }
});

// ===== 📅 주간 점수 =====
let wkFrom = null;
let wkTo = null;
const fmtDate = (d) => d.toLocaleDateString('sv-SE');
function mondayOf(date) {
  const x = new Date(date);
  const dow = (x.getDay() + 6) % 7; // 월=0
  x.setDate(x.getDate() - dow);
  return x;
}
function setWeekCurrent() {
  const mon = mondayOf(new Date());
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  wkFrom = fmtDate(mon);
  wkTo = fmtDate(sun);
}
function dowLabel(dateStr) {
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  return names[new Date(dateStr + 'T00:00:00').getDay()];
}
async function loadWeekly() {
  if (!wkFrom || !wkTo) setWeekCurrent();
  const d = await api(`/api/weekly?from=${wkFrom}&to=${wkTo}`);
  wkFrom = d.from;
  wkTo = d.to;
  $('#wk-range').textContent = `${d.from} ~ ${d.to}`;
  const ns = d.nonSchool || {}; // 비수업일(주말·공휴일·휴업일) date -> 사유
  const ev = d.events || {}; // 학사일정 행사(시험 등) date -> 이름
  const head = $('#wk-head');
  head.innerHTML =
    '<th>번호</th><th>이름</th>' +
    d.dates
      .map((dt) => {
        const off = ns[dt];
        const sub = off ? off : ev[dt] ? ev[dt] : dowLabel(dt);
        const title = off || ev[dt] || '';
        return `<th class="${off ? 'wk-off' : ev[dt] ? 'wk-event' : ''}" title="${title}">${dt.slice(5)}<br><span class="footnote">${sub}</span></th>`;
      })
      .join('') +
    '<th>합계</th>';
  const rows = $('#wk-rows');
  if (!d.students.length) {
    rows.innerHTML = `<tr><td colspan="${d.dates.length + 3}" class="empty">등록된 학생이 없습니다.</td></tr>`;
    return;
  }
  rows.innerHTML = d.students
    .map((s) => {
      const cells = d.dates
        .map((dt) => {
          const e = s.days[dt];
          if (!e) {
            // 비수업일은 결석이 아니라 휴일로 표시
            if (ns[dt]) return `<td class="wk-cell wk-off" title="${ns[dt]}">–</td>`;
            return '<td class="wk-cell wk-cell--absent" title="결석">·</td>';
          }
          const cls = e.status === 'ontime' ? 'wk-cell--ontime' : 'wk-cell--late';
          return `<td class="wk-cell ${cls}" title="${e.status === 'ontime' ? '정시' : '지각'}">${e.score}</td>`;
        })
        .join('');
      return `<tr><td><b>${s.student_no ?? ''}</b></td><td>${displayName(s)}</td>${cells}<td class="wk-total">${s.total}</td></tr>`;
    })
    .join('');
}
function shiftWeek(deltaDays) {
  const f = new Date(wkFrom + 'T00:00:00');
  const t = new Date(wkTo + 'T00:00:00');
  f.setDate(f.getDate() + deltaDays);
  t.setDate(t.getDate() + deltaDays);
  wkFrom = fmtDate(f);
  wkTo = fmtDate(t);
  loadWeekly();
}
$('#wk-prev').addEventListener('click', () => shiftWeek(-7));
$('#wk-next').addEventListener('click', () => shiftWeek(7));
$('#wk-today').addEventListener('click', () => {
  setWeekCurrent();
  loadWeekly();
});
$('#wk-export').addEventListener('click', () => {
  window.location = apiUrl(`/api/weekly/export?from=${wkFrom}&to=${wkTo}`);
});

// ===== ⌨ HID(키보드) 리더기 입력 =====
const HID_KEY = 'hidReaderOn';
let hidOn = localStorage.getItem(HID_KEY) === '1';
let hidBuf = '';
let hidTimer = null;
function setHidStatus() {
  const el = $('#hid-status');
  if (el) el.textContent = hidOn ? '✅ 켜짐 — 카드를 대면 자동으로 출석 처리됩니다.' : '꺼짐';
}
function initHid() {
  const cb = $('#hid-on');
  if (cb) {
    cb.checked = hidOn;
    cb.addEventListener('change', () => {
      hidOn = cb.checked;
      localStorage.setItem(HID_KEY, hidOn ? '1' : '0');
      setHidStatus();
    });
  }
  setHidStatus();
}
document.addEventListener('keydown', (e) => {
  if (!hidOn) return;
  const ae = document.activeElement;
  // 입력칸에 포커스가 있으면 가로채지 않음 (등록칸 자동입력·직접 타이핑 보호)
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  if (e.key === 'Enter') {
    if (hidBuf.length >= 2) submitCardInput(hidBuf);
    hidBuf = '';
    clearTimeout(hidTimer);
    return;
  }
  if (e.key.length === 1 && e.key !== ' ') {
    hidBuf += e.key;
    clearTimeout(hidTimer);
    hidTimer = setTimeout(() => (hidBuf = ''), 300); // 입력이 끊기면 버퍼 초기화
  }
});
function submitCardInput(uid) {
  fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid }),
  }).catch(() => {});
}
initHid();

// ===== 💾 데이터 관리 =====
const EXPORT_URL = {
  attendance: '/api/attendance/export',
  weekly: '/api/weekly/export',
  mood: '/api/export/mood',
  points: '/api/export/points',
  library: '/api/export/library',
  physical: '/api/export/physical',
};
function renderDataStats(s) {
  const items = [
    ['학생', s.students],
    ['출석 기록', s.attendance],
    ['감정 기록', s.moods],
    ['포인트 보유', s.points],
    ['등록 도서', s.books],
    ['대여 기록', s.loans],
    ['셔틀런 기록', s.shuttle],
    ['서킷 기록', s.circuit],
  ];
  $('#data-stats').innerHTML = items
    .map(([k, v]) => `<div class="datacell"><div class="datacell__num">${v ?? 0}</div><div class="datacell__lbl">${k}</div></div>`)
    .join('');
  // 초기화 항목 옆 건수 갱신
  const set = (id, v) => { const el = $(id); if (el) el.textContent = `(${v ?? 0}건)`; };
  set('#rc-attendance', s.attendance);
  set('#rc-mood', s.moods);
  set('#rc-points', s.points);
  set('#rc-library', s.loans);
  set('#rc-physical', (s.shuttle ?? 0) + (s.circuit ?? 0));
}
async function loadDataManager() {
  try {
    renderDataStats(await api('/api/data-stats'));
  } catch {}
}
$('#btn-backup').addEventListener('click', () => {
  window.location = apiUrl('/api/backup');
});
document.querySelectorAll('[data-export]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const url = EXPORT_URL[btn.dataset.export];
    if (url) window.location = apiUrl(url);
  });
});
document.querySelectorAll('[data-reset]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const scope = btn.dataset.reset;
    const label = btn.dataset.label;
    const heavy = scope === 'all' || scope === 'records';
    if (!confirm(`정말 '${label}'을(를) 초기화할까요?\n이 작업은 되돌릴 수 없습니다. 먼저 전체 백업을 받아두는 것을 권장합니다.`)) return;
    if (heavy && !confirm(`⚠ 한 번 더 확인합니다.\n'${label}' 초기화를 진행하면 복구할 수 없습니다. 계속할까요?`)) return;
    if (scope === 'all') {
      const typed = prompt("공장 초기화를 진행하려면 '삭제'라고 입력하세요.");
      if (typed !== '삭제') {
        showDataMsg('', '공장 초기화를 취소했습니다.');
        return;
      }
    }
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    });
    if (res.ok) {
      const r = await res.json();
      renderDataStats(r.stats);
      showDataMsg('ok', `'${label}' 초기화 완료.`);
    } else {
      const err = await res.json().catch(() => ({}));
      showDataMsg('err', err.error || '초기화 실패');
    }
  });
});
function showDataMsg(kind, text) {
  const el = $('#data-msg');
  if (!el) return;
  el.className = 'msg ' + (kind || '');
  el.textContent = text;
}
function updateConnText(active) {
  const el = $('#set-conn');
  if (active && active.connected) {
    el.innerHTML = `<span class="conn-ok">● 연결됨</span> — 포트 <b>${active.port}</b> · ${active.baudRate} bps`;
  } else {
    el.innerHTML = `<span class="conn-bad">● 연결 안 됨</span> — 리더기를 찾는 중이거나 포트 설정이 필요합니다.`;
  }
}
function togglePortWrap() {
  // 자동 탐지를 끄면 포트 직접 선택 활성화 (켜져 있어도 선택은 가능하게 둠)
  const auto = $('#set-auto').checked;
  $('#set-port').disabled = false;
  $('#set-port-wrap').style.opacity = auto ? 0.65 : 1;
}
$('#set-auto').addEventListener('change', togglePortWrap);
$('#ports-refresh').addEventListener('click', () => loadPorts($('#set-port').value));

async function loadPorts(selected) {
  const ports = await api('/api/ports');
  const sel = $('#set-port');
  sel.innerHTML = ports
    .map((p) => {
      const label =
        `${p.path}` +
        (p.isReader ? '  ★ CR-100 리더기' : p.friendlyName ? `  (${p.friendlyName})` : p.manufacturer ? `  (${p.manufacturer})` : '');
      return `<option value="${p.path}"${p.path === selected ? ' selected' : ''}>${label}</option>`;
    })
    .join('') || '<option value="">감지된 포트가 없습니다</option>';
  // 리더기가 자동 감지되면 안내
  const reader = ports.find((p) => p.isReader);
  const msg = $('#set-msg');
  if (reader && !selected) sel.value = reader.path;
  if (!ports.length) {
    msg.className = 'msg err';
    msg.textContent = '시리얼 포트가 하나도 안 보입니다. 리더기 USB 연결과 CP210x 드라이버를 확인하세요.';
  } else if (!reader) {
    msg.className = 'msg';
    msg.textContent = 'CR-100(Silicon Labs)이 자동 인식되지 않았습니다. 목록에서 리더기 포트를 직접 골라 적용해 보세요.';
  } else {
    msg.className = 'msg ok';
    msg.textContent = `리더기를 ${reader.path} 에서 찾았습니다.`;
  }
}

$('#set-apply').addEventListener('click', async () => {
  const body = {
    autoDetect: $('#set-auto').checked,
    port: $('#set-port').value,
    baudRate: Number($('#set-baud').value),
  };
  const msg = $('#set-msg');
  msg.className = 'msg';
  msg.textContent = '적용 중...';
  const res = await fetch('/api/serial-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    msg.className = 'msg ok';
    msg.textContent = `적용했습니다 (${body.port} · ${body.baudRate} bps). 이제 카드를 태그해 아래 진단에서 확인하세요.`;
  } else {
    msg.className = 'msg err';
    msg.textContent = '적용 실패';
  }
});

// 실시간 raw 데이터 로그
function onRaw(ev) {
  const log = $('#raw-log');
  const empty = log.querySelector('.rawlog__empty');
  if (empty) empty.remove();
  const t = new Date(ev.time).toLocaleTimeString('ko-KR');
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<span class="meta">[${t}] ${ev.bytes}B</span> <span class="hex">${ev.hex}</span><span class="txt">${ev.text}</span>`;
  log.prepend(row);
  while (log.children.length > 40) log.lastChild.remove();
}

// ===== 🌙/☀️ 테마 (라이트/다크) =====
const themeBtn = $('#theme-toggle');
function applyTheme(t) {
  document.body.classList.toggle('dark', t === 'dark');
  themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
  themeBtn.title = t === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환';
}
applyTheme(localStorage.getItem('theme') || 'light');
themeBtn.addEventListener('click', () => {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme(next);
});

// ---- 시작 ----
$('#rec-date').value = new Date().toLocaleDateString('sv-SE');
$('#dash-date').value = new Date().toLocaleDateString('sv-SE');
api('/api/status').then((s) => setStatus(s.connected));
loadToday();
connectSSE();
loadAirWeather(); // 미세먼지·날씨 위젯 (사용 설정 시에만 표시)
setInterval(() => loadAirWeather(true), 600000); // 10분마다 갱신
loadNeisMeal(); // 오늘 급식 위젯 (사용 설정 시에만 표시)
loadNeisSchedule(); // 학사일정 위젯 (사용 설정 시에만 표시)
