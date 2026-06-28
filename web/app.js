// 프론트엔드 로직
const $ = (sel) => document.querySelector(sel);
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
    if (btn.dataset.tab === 'mood') loadMoodStats();
    if (btn.dataset.tab === 'points') loadPointsTab();
    if (btn.dataset.tab === 'library') loadLibrary();
    if (btn.dataset.tab === 'shuttle') loadShuttle();
    if (btn.dataset.tab === 'circuit') loadCircuit();
    if (btn.dataset.tab === 'settings') loadSettings();
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

  // 학생 등록 화면에서 카드 UID 자동 입력
  if ($('#tab-students').classList.contains('active')) {
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
    bigcard('bigcard--dup', ev.student.name, '이미 출석 처리됨');
    return;
  }
  // 정상 출석
  const t = new Date(ev.attendance.tapped_at.replace(' ', 'T')).toLocaleTimeString('ko-KR');
  bigcard('bigcard--ok', ev.student.name, '출석 완료 · ' + t);
  todayCount++;
  $('#today-count').textContent = todayCount;
  const li = document.createElement('li');
  li.innerHTML = `<span class="t-name">${ev.student.name}</span><span class="t-time">${t}</span>`;
  todayList.prepend(li);

  // 출석 직후 "오늘의 기분" 선택 화면 띄우기 (감정 출석부)
  if (ev.attendance?.id) showMoodPicker(ev.student, ev.attendance.id);
}

// ===== 오늘의 기분 선택 (감정 출석부) =====
let moodTimer = null;
function showMoodPicker(student, attendanceId) {
  const overlay = $('#mood-overlay');
  $('#mood-who').textContent = `${student.name}님,`;
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
    $('#mood-skip').addEventListener('click', hideMoodPicker);
  }, 1500);
}
$('#mood-skip').addEventListener('click', hideMoodPicker);

function connectSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'status') {
      setStatus(ev.connected, ev.message);
      if ($('#tab-settings')?.classList.contains('active')) updateConnText(ev);
    }
    if (ev.type === 'tap') onTap(ev);
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
    li.innerHTML = `<span class="t-name">${r.name ?? '(미등록)'}</span><span class="t-time">${t}</span>`;
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
      <td>${s.name}</td>
      <td>${s.student_no ?? ''}</td>
      <td>${s.grade ?? ''}</td>
      <td class="uid">${s.card_uid}</td>
      <td><button class="danger" data-id="${s.id}">삭제</button></td>`;
    tr.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`${s.name} 학생을 삭제할까요?`)) return;
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
    msg.className = 'msg ok';
    msg.textContent = `${body.name} 학생 등록 완료!`;
    e.target.reset();
    loadStudents();
  } else {
    const err = await res.json();
    msg.className = 'msg err';
    msg.textContent = err.error || '등록 실패';
  }
});

// ---- 출석 현황 ----
async function loadRecords() {
  const date = $('#rec-date').value;
  const rows = await api('/api/attendance' + (date ? '?date=' + date : ''));
  const tbody = $('#rec-rows');
  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.name ?? '(미등록)'}</td><td class="uid">${r.card_uid}</td><td>${r.tapped_at}</td>`;
    tbody.append(tr);
  }
}
$('#rec-load').addEventListener('click', loadRecords);
$('#rec-export').addEventListener('click', async () => {
  const date = $('#rec-date').value;
  // 크롬북 버전: fetch 로 CSV 를 받아 Blob 으로 저장 (브라우저 내부 백엔드)
  const res = await fetch('/api/attendance/export' + (date ? '?date=' + date : ''));
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `attendance_${date || 'all'}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---- 대시보드 ----
async function loadDashboard() {
  const date = $('#dash-date').value || new Date().toLocaleDateString('sv-SE');
  const d = await api('/api/dashboard?date=' + date);

  $('#s-present').textContent = d.presentCount;
  $('#s-absent').textContent = d.absentCount;
  $('#s-total').textContent = d.totalStudents;
  $('#s-rate').textContent = d.rate + '%';
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
          return `<li><span>${s.name}</span><span class="nl-sub">${t}</span></li>`;
        })
        .join('')
    : '<li class="empty">출석한 학생이 없습니다.</li>';
  const absent = $('#absent-list');
  absent.innerHTML = d.absent.length
    ? d.absent.map((s) => `<li><span>${s.name}</span><span class="nl-sub">${s.grade ?? ''}</span></li>`).join('')
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
      <td style="font-weight: bold;">${s.name}</td>
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
  $('#point-student-name').textContent = student.name;
  $('#point-student-detail').textContent = `${student.grade || '학년/반 미지정'} · 학번 ${student.student_no || '미지정'}`;
  $('#point-student-val').textContent = student.points || 0;
  
  // 포인트 인식창 상태를 녹색 성공 상태로 변환합니다.
  resetPointsScannerCard('bigcard--ok', '카드 인식 완료', `${student.name} 학생의 포인트 조작이 가능합니다.`);
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
  sel.innerHTML = '<option value="">학생을 선택하세요</option>' + students.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
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
  await loadPorts(cfg.port);
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
