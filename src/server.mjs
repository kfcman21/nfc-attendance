// CR-100 출석 프로그램 - 로컬 웹서버
import express from 'express';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SerialPort } from 'serialport';
import { Reader } from './reader.mjs';
import * as db from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf8'));

// 사용자가 진단 화면에서 저장한 시리얼 설정(settings.json)을 덮어쓰기 적용
const DATA_DIR = process.env.NFC_DATA_DIR || join(__dirname, '..', 'data');
const SETTINGS_PATH = join(DATA_DIR, 'settings.json');
// 점수 설정 기본값 (config.json에 없을 때 대비)
config.scoring = { fullScore: 10, onTimeBy: '09:00', ...(config.scoring || {}) };
// Google Sheets 동기화 설정 기본값 (Apps Script Web App 방식)
config.sheets = { enabled: false, url: '', ...(config.sheets || {}) };
// 공공데이터(data.go.kr) 연동: 공휴일 + 미세먼지 + 날씨.
// serviceKey는 공통(폴백) 키이고, 각 서비스(holidays/air/weather)에 개별 키를 따로 넣을 수 있다.
config.publicData = { serviceKey: '', ...(config.publicData || {}) };
config.publicData.holidays = { enabled: false, key: '', ...(config.publicData.holidays || {}) };
config.publicData.air = { key: '', ...(config.publicData.air || {}) };
config.publicData.weather = { key: '', ...(config.publicData.weather || {}) };
config.publicData.airweather = {
  enabled: false,
  sido: '서울',
  nx: 60,
  ny: 127,
  ...(config.publicData.airweather || {}),
};
// NEIS 교육정보 개방 포털: 급식 식단 + 학사일정. 인증키 + 학교코드 공유.
config.neis = { key: '', atptCode: '', schoolCode: '', schoolName: '', ...(config.neis || {}) };
config.neis.meal = { enabled: false, ...(config.neis.meal || {}) };
config.neis.schedule = { enabled: false, ...(config.neis.schedule || {}) };
try {
  if (existsSync(SETTINGS_PATH)) {
    const saved = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    if (saved.serial) config.serial = { ...config.serial, ...saved.serial };
    if (saved.scoring) config.scoring = { ...config.scoring, ...saved.scoring };
    if (saved.sheets) config.sheets = { ...config.sheets, ...saved.sheets };
    if (saved.publicData) {
      if (saved.publicData.serviceKey !== undefined) config.publicData.serviceKey = saved.publicData.serviceKey;
      if (saved.publicData.holidays) config.publicData.holidays = { ...config.publicData.holidays, ...saved.publicData.holidays };
      if (saved.publicData.air) config.publicData.air = { ...config.publicData.air, ...saved.publicData.air };
      if (saved.publicData.weather) config.publicData.weather = { ...config.publicData.weather, ...saved.publicData.weather };
      if (saved.publicData.airweather) config.publicData.airweather = { ...config.publicData.airweather, ...saved.publicData.airweather };
    }
    if (saved.neis) {
      for (const k of ['key', 'atptCode', 'schoolCode', 'schoolName'])
        if (saved.neis[k] !== undefined) config.neis[k] = saved.neis[k];
      if (saved.neis.meal) config.neis.meal = { ...config.neis.meal, ...saved.neis.meal };
      if (saved.neis.schedule) config.neis.schedule = { ...config.neis.schedule, ...saved.neis.schedule };
    }
  }
} catch {}

// settings.json을 통째로 덮어쓰지 않고 일부만 병합 저장 (serial·scoring 공존)
function saveSettings(patch) {
  let cur = {};
  try {
    if (existsSync(SETTINGS_PATH)) cur = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {}
  writeFileSync(SETTINGS_PATH, JSON.stringify({ ...cur, ...patch }, null, 2));
}

// ---- Google Sheets 동기화 (Apps Script Web App으로 JSON POST) ----
let lastSheetSync = null;
let lastSheetError = null;
async function postToSheets(payload, timeoutMs = 8000) {
  if (!config.sheets.url) throw new Error('Google Sheets 주소(Web App URL)가 설정되지 않았습니다.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(config.sheets.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  } finally {
    clearTimeout(timer);
  }
}

// 출석 한 건을 시트에 추가 (실패해도 출석 기능에는 영향 없음 — fire-and-forget)
function syncAttendanceRow(student, record, status, score) {
  if (!config.sheets.enabled || !config.sheets.url) return;
  const [date, time = ''] = String(record.tapped_at).split(' ');
  postToSheets({
    action: 'append',
    row: {
      date,
      time,
      number: student.student_no ?? '',
      name: student.name ?? '',
      status: status === 'ontime' ? '정시' : '지각',
      score,
      card_uid: record.card_uid,
    },
  })
    .then(() => {
      lastSheetSync = new Date().toISOString();
      lastSheetError = null;
    })
    .catch((e) => {
      lastSheetError = e.message;
      console.error('[Sheets] 자동 동기화 실패:', e.message);
    });
}

// ===== 🌐 공공데이터(data.go.kr) 연동: 공휴일 · 미세먼지 · 날씨 =====
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// 공공/NEIS API는 가끔 5xx·HTML 오류 페이지를 돌려준다. 1회 재시도 + 깔끔한 오류 메시지.
async function fetchJson(url, timeoutMs = 8000, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // 일부 게이트웨이는 빈 User-Agent를 403으로 막으므로 브라우저 UA를 보낸다.
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NFC-Attendance',
          Accept: 'application/json',
        },
      });
      const text = await res.text();
      // HTML 형식의 오류 페이지인지 검사 (DOCTYPE이나 html 태그가 포함되어 있거나 < 로 시작하는 경우)
      const looksHtml = /<html|<doctype/i.test(text) || /^\s*</.test(text);
      if (!res.ok) {
        // 5xx는 일시적 서버 오류일 수 있어 한 번 더 시도
        if (res.status >= 500 && attempt < retries) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        
        // 호출하는 URL에 따라 어떤 API 서버인지 판별합니다.
        const isNeis = url.includes('neis.go.kr');
        const serverName = isNeis ? '나이스 교육정보 개방 포털' : '공공데이터';

        throw new Error(
          looksHtml
            ? `${serverName} 서버 오류(HTTP ${res.status}) — 잠시 후 다시 시도하세요. 계속되면 인증키·서비스 신청(승인) 상태를 확인하세요.`
            : `HTTP ${res.status} ${text.slice(0, 100)}`
        );
      }
      try {
        return JSON.parse(text);
      } catch {
        // JSON 파싱 에러 시에도 동일하게 서버 이름을 동적으로 표시합니다.
        const isNeis = url.includes('neis.go.kr');
        const serverName = isNeis ? '나이스 교육정보 개방 포털' : '공공데이터';

        throw new Error(
          looksHtml
            ? `${serverName} 서버가 JSON 대신 오류 페이지를 반환했습니다 — 인증키 형식(Decoding)·서비스 신청 상태를 확인하세요.`
            : 'JSON 응답이 아닙니다: ' + text.slice(0, 120)
        );
      }
    } catch (e) {
      lastErr = e;
      const retriable = e.name === 'AbortError' || /fetch failed|ENOTFOUND|ECONNRESET|EAI_AGAIN|network|timeout/i.test(e.message || '');
      if (attempt < retries && retriable) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('요청 실패');
}

// 서비스별 인증키 (개별 키가 없으면 공통 serviceKey로 폴백)
const holidayKey = () => config.publicData.holidays.key || config.publicData.serviceKey || '';
const airKey = () => config.publicData.air.key || config.publicData.serviceKey || '';
const weatherKey = () => config.publicData.weather.key || config.publicData.serviceKey || '';

// ---- 공휴일 (한국천문연구원 특일정보) ----
const holidayCache = new Map(); // 'YYYY-MM' -> { 'YYYY-MM-DD': 이름 }
async function fetchHolidayMonth(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  if (holidayCache.has(key)) return holidayCache.get(key);
  const url =
    'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo' +
    `?ServiceKey=${encodeURIComponent(holidayKey())}` +
    `&solYear=${year}&solMonth=${String(month).padStart(2, '0')}&numOfRows=100&_type=json`;
  const data = await fetchJson(url);
  let items = data?.response?.body?.items?.item;
  items = items ? (Array.isArray(items) ? items : [items]) : [];
  const map = {};
  for (const it of items) {
    if (it.isHoliday === 'Y' && it.locdate) {
      const s = String(it.locdate);
      map[`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`] = it.dateName;
    }
  }
  holidayCache.set(key, map);
  return map;
}
async function fetchHolidaysForRange(from, to) {
  const out = {};
  const seen = new Set();
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = cur.getMonth() + 1;
    const k = `${y}-${m}`;
    if (!seen.has(k)) {
      seen.add(k);
      Object.assign(out, await fetchHolidayMonth(y, m));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// ---- 미세먼지 (에어코리아) ----
async function fetchAir() {
  const pd = config.publicData;
  const url =
    'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty' +
    `?serviceKey=${encodeURIComponent(airKey())}&returnType=json&numOfRows=100&pageNo=1` +
    `&sidoName=${encodeURIComponent(pd.airweather.sido || '서울')}&ver=1.3`;
  const data = await fetchJson(url);
  const items = data?.response?.body?.items || [];
  const valid = items.find((i) => i.pm10Value && i.pm10Value !== '-') || items[0] || {};
  return { pm10: num(valid.pm10Value), pm25: num(valid.pm25Value), station: valid.stationName, airTime: valid.dataTime };
}

// ---- 날씨 (기상청 초단기실황) ----
function kmaBaseDateTime(now = new Date()) {
  const d = new Date(now);
  if (d.getMinutes() < 40) d.setHours(d.getHours() - 1); // 실황은 매 정시+40분 제공
  return {
    base_date: d.toLocaleDateString('sv-SE').replace(/-/g, ''),
    base_time: String(d.getHours()).padStart(2, '0') + '00',
  };
}
async function fetchWeather() {
  const pd = config.publicData;
  const { base_date, base_time } = kmaBaseDateTime();
  const url =
    'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst' +
    `?serviceKey=${encodeURIComponent(weatherKey())}&numOfRows=100&pageNo=1&dataType=JSON` +
    `&base_date=${base_date}&base_time=${base_time}&nx=${pd.airweather.nx || 60}&ny=${pd.airweather.ny || 127}`;
  const data = await fetchJson(url);
  const items = data?.response?.body?.items?.item || [];
  const get = (c) => items.find((i) => i.category === c)?.obsrValue;
  return { temp: num(get('T1H')), pty: num(get('PTY')), humidity: num(get('REH')), rain1h: get('RN1') };
}

// 미세먼지 통합 등급 (나쁜 쪽 기준)
function pmGrade(pm10, pm25) {
  const g10 = pm10 == null ? 0 : pm10 <= 30 ? 1 : pm10 <= 80 ? 2 : pm10 <= 150 ? 3 : 4;
  const g25 = pm25 == null ? 0 : pm25 <= 15 ? 1 : pm25 <= 35 ? 2 : pm25 <= 75 ? 3 : 4;
  return ['정보없음', '좋음', '보통', '나쁨', '매우나쁨'][Math.max(g10, g25)];
}
const PTY_LABEL = { 0: '맑음/흐림', 1: '비', 2: '비/눈', 3: '눈', 5: '빗방울', 6: '진눈깨비', 7: '눈날림' };

// ===== 🏫 NEIS 교육정보 개방 포털: 급식 · 학사일정 =====
async function neisFetch(path, params) {
  const q = new URLSearchParams({ KEY: config.neis.key, Type: 'json', pIndex: 1, ...params }).toString();
  const data = await fetchJson(`https://open.neis.go.kr/hub/${path}?${q}`);
  const top = data[path];
  if (!top) {
    const code = data?.RESULT?.CODE;
    if (code === 'INFO-200') return []; // 데이터 없음
    if (code && code !== 'INFO-000') throw new Error(`${code} ${data?.RESULT?.MESSAGE || ''}`);
    return [];
  }
  const rowObj = top.find((x) => x.row);
  return rowObj ? rowObj.row : [];
}

const ALLERGY = {
  1: '난류', 2: '우유', 3: '메밀', 4: '땅콩', 5: '대두', 6: '밀', 7: '고등어', 8: '게', 9: '새우',
  10: '돼지고기', 11: '복숭아', 12: '토마토', 13: '아황산', 14: '호두', 15: '닭고기', 16: '쇠고기',
  17: '오징어', 18: '조개류', 19: '잣',
};
function parseDish(ddish) {
  return String(ddish || '')
    .split(/<br\s*\/?>/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^(.*?)\s*\(([\d.\s]+)\)\s*$/);
      if (!m) return { name: item, allergens: [] };
      const nums = m[2].split('.').map((x) => Number(x.trim())).filter((n) => n);
      return { name: m[1].trim(), allergens: nums };
    });
}

// 학사일정: 휴업일/방학을 비수업일로, 그 외 행사(시험 등)는 이벤트로
async function fetchNeisSchedule(from, to) {
  const n = config.neis;
  if (!n.key || !n.atptCode || !n.schoolCode) return { off: {}, events: {} };
  const rows = await neisFetch('SchoolSchedule', {
    ATPT_OFCDC_SC_CODE: n.atptCode,
    SD_SCHUL_CODE: n.schoolCode,
    AA_FROM_YMD: from.replace(/-/g, ''),
    AA_TO_YMD: to.replace(/-/g, ''),
    pSize: 100,
  });
  const off = {};
  const events = {};
  for (const r of rows) {
    const s = String(r.AA_YMD);
    if (s.length !== 8) continue;
    const d = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    const sc = r.SBTR_DD_SC_NM || '';
    if (/휴업|휴일|방학/.test(sc)) off[d] = r.EVENT_NM || sc;
    if (r.EVENT_NM) events[d] = r.EVENT_NM;
  }
  return { off, events };
}

// 태그 시각을 마감시각(onTimeBy)과 비교해 정시(만점)/지각(0점) 판정
function computeScore(date = new Date()) {
  const hhmm = date.toTimeString().slice(0, 5); // 'HH:MM' (로컬)
  const onTime = hhmm <= (config.scoring.onTimeBy || '09:00');
  return {
    status: onTime ? 'ontime' : 'late',
    score: onTime ? config.scoring.fullScore ?? 10 : 0,
  };
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// ---- 실시간 이벤트 (Server-Sent Events) ----
const clients = new Set();
function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(data);
}

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'status', ...reader.statusInfo })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// ---- 리더기 ----
const reader = new Reader(config);
const lastSeen = new Map(); // 메모리 디바운스
const debounceMs = (config.attendance?.debounceSeconds ?? 5) * 1000;

// ---- 리더기 모드 상태 ----
// attendance(출석) | lending(도서대여) | shuttle(셔틀런) | circuit(서킷)
const goalBooks = config.reading?.goalBooks ?? 100;
let mode = 'attendance';
let pendingBorrow = null; // { student, timer }

function clearPending() {
  if (pendingBorrow?.timer) clearTimeout(pendingBorrow.timer);
  pendingBorrow = null;
}

// 셔틀런 라이브 상태: studentId -> { studentId, name, laps }
const shuttleLive = new Map();
// 서킷 진행중 세션: stationId -> { studentId, studentName, stationId, stationName, startMs }
const circuitActive = new Map();
let pendingCircuit = null; // { student, timer }
function clearPendingCircuit() {
  if (pendingCircuit?.timer) clearTimeout(pendingCircuit.timer);
  pendingCircuit = null;
}

// 🏃 셔틀런: 학생 카드를 태그할 때마다 왕복수 +1
function handleShuttleTap(uid) {
  const student = db.getStudentByCard(uid);
  if (!student) {
    broadcast({ type: 'shuttle', step: 'unknown', uid });
    return;
  }
  const cur = shuttleLive.get(student.id) ?? { studentId: student.id, name: student.name, laps: 0 };
  cur.laps += 1;
  shuttleLive.set(student.id, cur);
  const best = db.shuttleBest(student.id);
  const isNewBest = cur.laps > best && best > 0;
  console.log(`[셔틀런] ${student.name} ${cur.laps}회${isNewBest ? ' 🎉최고기록' : ''}`);
  broadcast({ type: 'shuttle', step: 'lap', student, laps: cur.laps, best, isNewBest });
}

// 🏋️ 서킷: [학생] → [스테이션] 시작, 같은 조합 다시 → 종료(시간 기록)
function handleCircuitTap(uid) {
  const student = db.getStudentByCard(uid);
  const station = db.getStationByCard(uid);

  if (student) {
    clearPendingCircuit();
    pendingCircuit = {
      student,
      timer: setTimeout(() => {
        pendingCircuit = null;
        broadcast({ type: 'circuit', step: 'timeout' });
      }, 20000),
    };
    broadcast({ type: 'circuit', step: 'student', student });
    return;
  }

  if (station) {
    const active = circuitActive.get(station.id);

    // 스테이션 카드만 태그 → 진행 중이면 종료 (시간 기록)
    if (active) {
      const durationSec = Math.max(1, Math.round((Date.now() - active.startMs) / 1000));
      circuitActive.delete(station.id);
      clearPendingCircuit();
      const prevBest = db.circuitBest(station.id, active.studentId);
      db.addCircuitRecord(station.id, active.studentId, durationSec);
      const isNewBest = durationSec > prevBest;
      const student = db.getStudentById(active.studentId);
      console.log(`[서킷] ${active.studentName} · ${station.name} 완료 ${durationSec}초${isNewBest ? ' 🎉최고' : ''}`);
      broadcast({ type: 'circuit', step: 'finished', student, station, durationSec, prevBest, isNewBest });
      return;
    }

    // 진행 중이 아니면 시작 → 직전에 학생 카드가 태그돼 있어야 함
    if (!pendingCircuit) {
      broadcast({ type: 'circuit', step: 'need-student', station });
      return;
    }
    const s = pendingCircuit.student;
    clearPendingCircuit();
    circuitActive.set(station.id, {
      studentId: s.id,
      studentName: s.name,
      stationId: station.id,
      stationName: station.name,
      startMs: Date.now(),
    });
    console.log(`[서킷] ${s.name} · ${station.name} 시작`);
    broadcast({ type: 'circuit', step: 'started', student: s, station });
    return;
  }

  broadcast({ type: 'circuit', step: 'unknown', uid });
}

function broadcastReading() {
  broadcast({ type: 'reading', stats: db.readingStats(goalBooks) });
}

// 대여 모드일 때 카드 태그 처리: [학생] → [도서] 순서로 대여, 책만 태그하면 반납
function handleLendingTap(uid) {
  const student = db.getStudentByCard(uid);
  const book = db.getBookByCard(uid);

  if (student) {
    clearPending();
    pendingBorrow = {
      student,
      timer: setTimeout(() => {
        pendingBorrow = null;
        broadcast({ type: 'lending', step: 'timeout' });
      }, 15000),
    };
    console.log(`[대여] 학생 태그: ${student.name} — 빌릴 책을 기다립니다`);
    broadcast({ type: 'lending', step: 'student', student });
    return;
  }

  if (book) {
    const active = db.activeLoanForBook(book.id);

    if (pendingBorrow) {
      // 학생 다음에 책 → 대여
      if (active) {
        broadcast({
          type: 'lending',
          step: 'error',
          message: `'${book.title}'은(는) 이미 대여 중입니다.`,
          book,
        });
        return;
      }
      const borrower = pendingBorrow.student;
      clearPending();
      const loan = db.createLoan(book.id, borrower.id);
      console.log(`[대여] ${borrower.name} → '${book.title}'`);
      broadcast({ type: 'lending', step: 'borrowed', student: borrower, book, loan });
      broadcastReading();
      return;
    }

    // 학생 없이 책만 태그 → 반납
    if (active) {
      const loan = db.returnLoan(active.id);
      const borrower = db.getStudentById(active.student_id);
      console.log(`[반납] '${book.title}' (빌린이: ${borrower?.name ?? '?'})`);
      broadcast({ type: 'lending', step: 'returned', book, loan, student: borrower });
      broadcastReading();
      return;
    }

    broadcast({ type: 'lending', step: 'need-student', book });
    return;
  }

  broadcast({ type: 'lending', step: 'unknown', uid });
}

// 🗑 카드 초기화: 태그한 카드가 무엇으로 등록됐는지 조회 (수정은 하지 않음)
function handleLookupTap(uid) {
  const student = db.getStudentByCard(uid);
  if (student) return broadcast({ type: 'lookup', uid, kind: 'student', item: student });
  const book = db.getBookByCard(uid);
  if (book) return broadcast({ type: 'lookup', uid, kind: 'book', item: book });
  const station = db.getStationByCard(uid);
  if (station) return broadcast({ type: 'lookup', uid, kind: 'station', item: station });
  broadcast({ type: 'lookup', uid, kind: 'none' });
}

reader.on('status', (status) => {
  broadcast({ type: 'status', ...status });
  console.log(`[리더기] ${status.message} (연결: ${status.connected})`);
});

// 진단용: 들어온 원시 바이트를 HEX/TEXT로 방송 (설정 화면에서 표시)
reader.on('raw', (chunk) => {
  const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const text = [...chunk].map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '·')).join('');
  broadcast({ type: 'raw', hex, text, bytes: chunk.length, time: new Date().toISOString() });
});

reader.on('card', (uid) => {
  // 활성 모드에 따라 카드 태그를 다르게 처리 (출석은 기본 모드에서만)
  if (mode === 'lending') { handleLendingTap(uid); return; }
  if (mode === 'shuttle') { handleShuttleTap(uid); return; }
  if (mode === 'circuit') { handleCircuitTap(uid); return; }
  if (mode === 'lookup') { handleLookupTap(uid); return; }

  const now = Date.now();
  const prev = lastSeen.get(uid) ?? 0;
  const duplicate = now - prev < debounceMs;
  lastSeen.set(uid, now);

  const student = db.getStudentByCard(uid);

  // 미등록 카드: 출석 기록 안 하고, 등록용으로 알림만
  if (!student) {
    console.log(`[카드] 미등록 카드 태그: ${uid}`);
    broadcast({ type: 'tap', uid, known: false, duplicate, time: new Date().toISOString() });
    return;
  }

  if (duplicate) {
    broadcast({ type: 'tap', uid, known: true, duplicate: true, student, time: new Date().toISOString() });
    return;
  }

  const { score, status } = computeScore();
  const record = db.recordAttendance(uid, { score, status });
  console.log(
    `[출석] ${student.name || (student.student_no ?? '') + '번'} (${uid}) @ ${record.tapped_at} · ${status === 'ontime' ? '정시 +' + score : '지각 0'}`
  );
  broadcast({
    type: 'tap',
    uid,
    known: true,
    duplicate: false,
    student,
    attendance: record,
    status,
    score,
    time: new Date().toISOString(),
  });
  syncAttendanceRow(student, record, status, score); // Google Sheets 자동 추가(켜진 경우)
});

reader.start();

// ---- API: 학생 ----
app.get('/api/students', (req, res) => res.json(db.listStudents()));

app.post('/api/students', (req, res) => {
  const { card_uid, name, student_no, grade } = req.body;
  // 개인정보 없이 번호만으로도 등록 가능: 카드와 (이름 또는 번호) 중 하나만 있으면 됨
  if (!card_uid || (!name && !student_no))
    return res.status(400).json({ error: '카드와, 이름 또는 번호 중 하나는 필요합니다.' });
  if (db.getStudentByCard(card_uid))
    return res.status(409).json({ error: '이미 등록된 카드입니다.' });
  try {
    res.json(db.addStudent({ card_uid, name, student_no, grade }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/students/:id', (req, res) => {
  res.json(db.updateStudent(Number(req.params.id), req.body));
});

// ---- 학생 포인트 수정 API ----
// delta 값이 있으면 기존 포인트에서 증감하고, points 값이 있으면 지정한 포인트로 변경합니다.
app.put('/api/students/:id/points', (req, res) => {
  const id = Number(req.params.id);
  const { delta, points } = req.body;
  
  try {
    let updated;
    if (delta !== undefined) {
      // 포인트 상대값 증감 (+5, -3 등)
      updated = db.adjustStudentPoints(id, Number(delta));
    } else if (points !== undefined) {
      // 포인트를 특정 값으로 직접 설정
      updated = db.updateStudentPoints(id, Number(points));
    } else {
      return res.status(400).json({ error: 'delta 또는 points 값이 필요합니다.' });
    }

    // 변경된 포인트를 실시간으로 접속된 모든 웹 화면에 전송합니다.
    broadcast({ type: 'points', studentId: id, points: updated.points, student: updated });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/students/:id', (req, res) => {
  db.deleteStudent(Number(req.params.id));
  res.json({ ok: true });
});

// ---- API: 대시보드 ----
app.get('/api/dashboard', (req, res) => {
  const date = req.query.date || new Date().toLocaleDateString('sv-SE');
  res.json(db.dashboardStats(date));
});

// ---- API: 감정 통계 ----
app.get('/api/mood-stats', (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE');
  const to = req.query.to || today;
  // 기본: 최근 7일
  const weekAgo = new Date(Date.now() - 6 * 86400000).toLocaleDateString('sv-SE');
  const from = req.query.from || weekAgo;
  res.json(db.moodStats(from, to));
});

// ---- API: 출석 ----
app.get('/api/attendance', (req, res) => {
  res.json(db.listAttendance(req.query.date || null));
});

// CSV 내보내기 (?date=YYYY-MM-DD 선택) — 번호·상태·점수 포함
app.get('/api/attendance/export', (req, res) => {
  const rows = db.listAttendanceExport(req.query.date || null);
  const statusLabel = { ontime: '정시', late: '지각' };
  const header = '번호,이름,카드UID,출석시각,상태,점수\n';
  const body = rows
    .map(
      (r) =>
        `"${r.student_no ?? ''}","${r.name ?? ''}","${r.card_uid}","${r.tapped_at}","${statusLabel[r.status] ?? ''}","${r.score ?? ''}"`
    )
    .join('\n');
  const csv = '﻿' + header + body; // BOM: 엑셀 한글 깨짐 방지
  const fname = `attendance_${req.query.date || 'all'}.csv`;
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(csv);
});

// 감정(오늘의 기분) 기록
app.post('/api/attendance/:id/mood', (req, res) => {
  const { mood } = req.body;
  const updated = db.setMood(Number(req.params.id), mood);
  broadcast({ type: 'mood', attendanceId: Number(req.params.id), mood });
  res.json(updated);
});

// ---- API: 모드 전환 ----
app.post('/api/mode', (req, res) => {
  const m = req.body.mode || 'attendance';
  mode = ['attendance', 'lending', 'shuttle', 'circuit', 'lookup'].includes(m) ? m : 'attendance';
  clearPending();
  clearPendingCircuit();
  console.log(`[모드] ${mode}`);
  broadcast({ type: 'mode', mode });
  broadcast({ type: 'lending', step: mode === 'lending' ? 'on' : 'off' });
  res.json({ mode });
});

// ---- API: 셔틀런 ----
app.get('/api/shuttle/live', (req, res) => res.json([...shuttleLive.values()]));
app.post('/api/shuttle/reset', (req, res) => {
  shuttleLive.clear();
  broadcast({ type: 'shuttle', step: 'reset' });
  res.json({ ok: true });
});
app.post('/api/shuttle/save', (req, res) => {
  const results = [];
  for (const v of shuttleLive.values()) {
    const prevBest = db.shuttleBest(v.studentId);
    db.addShuttleRecord(v.studentId, v.laps);
    results.push({ studentId: v.studentId, name: v.name, laps: v.laps, prevBest, isNewBest: v.laps > prevBest });
  }
  shuttleLive.clear();
  broadcast({ type: 'shuttle', step: 'saved' });
  res.json(results);
});
app.get('/api/shuttle/leaderboard', (req, res) => res.json(db.shuttleLeaderboard()));
app.get('/api/shuttle/records', (req, res) =>
  res.json(db.shuttleRecords(req.query.student_id ? Number(req.query.student_id) : null))
);

// ---- API: 서킷 스테이션 ----
app.get('/api/stations', (req, res) => res.json(db.listStations()));
app.post('/api/stations', (req, res) => {
  const { card_uid, name } = req.body;
  if (!card_uid || !name) return res.status(400).json({ error: '카드와 종목명은 필수입니다.' });
  if (db.getStationByCard(card_uid) || db.getStudentByCard(card_uid) || db.getBookByCard(card_uid))
    return res.status(409).json({ error: '이미 사용 중인 카드입니다.' });
  try {
    res.json(db.addStation({ card_uid, name }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/stations/:id', (req, res) => {
  db.deleteStation(Number(req.params.id));
  res.json({ ok: true });
});
app.get('/api/circuit/records', (req, res) =>
  res.json(
    db.circuitRecords(
      req.query.student_id ? Number(req.query.student_id) : null,
      req.query.station_id ? Number(req.query.station_id) : null
    )
  )
);
app.get('/api/circuit/growth/:studentId', (req, res) =>
  res.json(db.circuitGrowth(Number(req.params.studentId)))
);

// ---- API: 도서 대여 / 독서 ----

app.get('/api/books', (req, res) => res.json(db.listBooks()));

app.post('/api/books', (req, res) => {
  const { card_uid, title, author } = req.body;
  if (!card_uid || !title) return res.status(400).json({ error: '카드와 책 제목은 필수입니다.' });
  if (db.getBookByCard(card_uid))
    return res.status(409).json({ error: '이미 등록된 도서 카드입니다.' });
  if (db.getStudentByCard(card_uid))
    return res.status(409).json({ error: '학생 카드로는 도서를 등록할 수 없습니다.' });
  try {
    res.json(db.addBook({ card_uid, title, author }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/books/:id', (req, res) => {
  db.deleteBook(Number(req.params.id));
  res.json({ ok: true });
});

// 화면에서 직접 반납 (카드 태그 없이)
app.post('/api/books/:id/return', (req, res) => {
  const bookId = Number(req.params.id);
  const active = db.activeLoanForBook(bookId);
  if (!active) return res.status(400).json({ error: '대여 중인 도서가 아닙니다.' });
  const loan = db.returnLoan(active.id);
  broadcastReading();
  res.json({ ok: true, loan });
});

app.get('/api/reading/stats', (req, res) => res.json(db.readingStats(goalBooks)));

app.get('/api/reading/student/:id', (req, res) =>
  res.json(db.studentReadingRecord(Number(req.params.id)))
);

// 반납 후 별점·한 줄 평 기록
app.post('/api/loans/:id/review', (req, res) => {
  const { rating, review } = req.body;
  const updated = db.setLoanReview(Number(req.params.id), rating, review);
  broadcastReading();
  res.json(updated);
});

// ---- API: 상태 / 테스트 ----
app.get('/api/status', (req, res) => res.json(reader.statusInfo));

// ---- API: 진단 / 시리얼 설정 ----
// 감지된 시리얼 포트 목록 (리더기 인식 여부 확인용)
app.get('/api/ports', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json(
      ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer || '',
        friendlyName: p.friendlyName || '',
        vendorId: p.vendorId || '',
        productId: p.productId || '',
        isReader: (p.vendorId || '').toLowerCase() === '10c4' && (p.productId || '').toLowerCase() === 'ea60',
      }))
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 현재 시리얼 설정 조회
app.get('/api/serial-config', (req, res) => {
  res.json({
    autoDetect: config.serial.autoDetect !== false,
    port: config.serial.port,
    baudRate: config.serial.baudRate,
    active: reader.statusInfo,
  });
});

// 시리얼 설정 변경 + 재연결 + 저장 (다음 실행에도 유지)
app.post('/api/serial-config', async (req, res) => {
  const { autoDetect, port, baudRate } = req.body;
  const serial = { ...config.serial };
  if (autoDetect !== undefined) serial.autoDetect = !!autoDetect;
  if (port) serial.port = port;
  if (baudRate) serial.baudRate = Number(baudRate);
  config.serial = serial;
  try {
    saveSettings({ serial });
  } catch (e) {
    console.error('설정 저장 실패:', e.message);
  }
  await reader.reconfigure(serial);
  res.json({ ok: true, serial });
});

// ---- API: 점수(정시/지각) 설정 ----
app.get('/api/scoring-config', (req, res) => res.json(config.scoring));

app.post('/api/scoring-config', (req, res) => {
  const { fullScore, onTimeBy } = req.body;
  if (fullScore !== undefined && fullScore !== '') config.scoring.fullScore = Number(fullScore);
  if (onTimeBy) config.scoring.onTimeBy = String(onTimeBy).slice(0, 5);
  try {
    saveSettings({ scoring: config.scoring });
  } catch (e) {
    console.error('점수 설정 저장 실패:', e.message);
  }
  broadcast({ type: 'scoring', scoring: config.scoring });
  res.json(config.scoring);
});

// ---- API: 주간 점수 기록 ----
// from/to 미지정 시 이번 주(월~일)
function weekRange(q = {}) {
  let { from, to } = q;
  if (!from || !to) {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7; // 월=0 … 일=6
    const mon = new Date(d);
    mon.setDate(d.getDate() - dow);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    from = mon.toLocaleDateString('sv-SE');
    to = sun.toLocaleDateString('sv-SE');
  }
  return { from, to };
}

// 주간 점수 + (공휴일 기능 켜진 경우) 주말·공휴일을 결석에서 제외
async function buildWeekly(range = {}) {
  const { from, to } = weekRange(range);
  const weekly = db.weeklyScores(from, to);
  const nonSchool = {}; // 'YYYY-MM-DD' -> 사유(주말/공휴일명/휴업일명)
  const events = {}; // 'YYYY-MM-DD' -> 학사일정 행사명(시험 등)
  const holidaysOn = config.publicData.holidays.enabled;
  const scheduleOn = config.neis.schedule.enabled;
  if (holidaysOn || scheduleOn) {
    // 주말은 공통으로 비수업일 처리
    for (const d of weekly.dates) {
      const dow = new Date(d + 'T00:00:00').getDay();
      if (dow === 0 || dow === 6) nonSchool[d] = '주말';
    }
    // 공휴일 (data.go.kr 특일정보)
    if (holidaysOn && holidayKey()) {
      try {
        const holidays = await fetchHolidaysForRange(from, to);
        for (const d in holidays) nonSchool[d] = holidays[d];
      } catch (e) {
        console.error('[공휴일] 조회 실패:', e.message);
      }
    }
    // 학사일정 (NEIS): 휴업일/방학 → 비수업일, 행사 → 이벤트
    if (scheduleOn) {
      try {
        const sch = await fetchNeisSchedule(from, to);
        for (const d in sch.off) nonSchool[d] = sch.off[d];
        Object.assign(events, sch.events);
      } catch (e) {
        console.error('[학사일정] 조회 실패:', e.message);
      }
    }
    // 결석 수를 수업일 기준으로 재계산
    for (const s of weekly.students) {
      let absent = 0;
      for (const d of weekly.dates) {
        if (nonSchool[d]) continue;
        if (!s.days[d]) absent++;
      }
      s.absent = absent;
    }
  }
  return { ...weekly, nonSchool, events, holidaysEnabled: holidaysOn, scheduleEnabled: scheduleOn };
}

app.get('/api/weekly', async (req, res) => {
  const w = await buildWeekly(req.query);
  res.json({ ...w, fullScore: config.scoring.fullScore });
});

// 주간 점수 엑셀(CSV) 내보내기: 학생 × 날짜 점수표 + 합계/정시/지각/결석
app.get('/api/weekly/export', async (req, res) => {
  const data = await buildWeekly(req.query);
  const { from, to } = data;
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['번호', '이름', ...data.dates, '주간합계', '정시', '지각', '결석'].map(q).join(',');
  const lines = data.students.map((s) => {
    const cells = data.dates.map((d) => (s.days[d] ? s.days[d].score : ''));
    return [s.student_no ?? '', s.name ?? '', ...cells, s.total, s.ontime, s.late, s.absent]
      .map(q)
      .join(',');
  });
  const csv = '﻿' + header + '\n' + lines.join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="weekly_${from}_${to}.csv"`);
  res.send(csv);
});

// ===== 💾 데이터 관리: 백업 · 통계 · 내보내기 · 초기화 =====
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function sendCsv(res, filename, headerArr, rowArrs) {
  const csv = '﻿' + [headerArr, ...rowArrs].map((r) => r.map(csvCell).join(',')).join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.send(csv);
}
const MOOD_LABEL = {
  great: '아주 좋아요',
  good: '좋아요',
  soso: '그저 그래요',
  tired: '피곤해요',
  sad: '슬퍼요',
  angry: '화나요',
};

// 현재 데이터 건수
app.get('/api/data-stats', (req, res) => res.json(db.dataStats()));

// 전체 DB 백업 파일(.db) 내려받기
app.get('/api/backup', (req, res) => {
  const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');
  const tmp = join(DATA_DIR, `backup-${Date.now()}.db`);
  try {
    db.backupTo(tmp);
    res.download(tmp, `출석DB백업-${stamp}.db`, () => {
      try {
        unlinkSync(tmp);
      } catch {}
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 항목별 엑셀(CSV) 내보내기
app.get('/api/export/mood', (req, res) => {
  const rows = db.exportMoods();
  sendCsv(
    res,
    '감정기록.csv',
    ['번호', '이름', '날짜', '시각', '감정'],
    rows.map((r) => [r.student_no ?? '', r.name ?? '', r.d, r.tapped_at, MOOD_LABEL[r.mood] ?? r.mood])
  );
});
app.get('/api/export/points', (req, res) => {
  const rows = db.exportPoints();
  sendCsv(
    res,
    '포인트.csv',
    ['번호', '이름', '학년/반', '포인트'],
    rows.map((r) => [r.student_no ?? '', r.name ?? '', r.grade ?? '', r.points ?? 0])
  );
});
app.get('/api/export/library', (req, res) => {
  const rows = db.exportLoans();
  sendCsv(
    res,
    '도서대여기록.csv',
    ['번호', '이름', '책제목', '지은이', '대여일', '반납일', '별점', '한줄평'],
    rows.map((r) => [
      r.student_no ?? '',
      r.student_name ?? '',
      r.title ?? '',
      r.author ?? '',
      r.borrowed_at ?? '',
      r.returned_at ?? '',
      r.rating ?? '',
      r.review ?? '',
    ])
  );
});
app.get('/api/export/physical', (req, res) => {
  const rows = db.exportPhysical();
  sendCsv(
    res,
    '체육기록.csv',
    ['번호', '이름', '종류', '기록', '단위', '일시'],
    rows.map((r) => [r.student_no ?? '', r.name ?? '', r.kind, r.value, r.unit, r.created_at])
  );
});

// 초기화 (되돌릴 수 없음) — scope별
app.post('/api/reset', (req, res) => {
  const scope = req.body.scope;
  const fns = {
    attendance: db.resetAttendance,
    mood: db.resetMoods,
    points: db.resetPoints,
    library: db.resetLibraryRecords,
    physical: db.resetPhysicalRecords,
    records: db.resetAllRecords,
    all: db.factoryReset,
  };
  const fn = fns[scope];
  if (!fn) return res.status(400).json({ error: '알 수 없는 초기화 대상입니다.' });
  try {
    fn();
    console.log(`[초기화] ${scope}`);
    broadcast({ type: 'reset', scope });
    res.json({ ok: true, scope, stats: db.dataStats() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 📗 Google Sheets 동기화 =====
app.get('/api/sheets-config', (req, res) => {
  res.json({
    enabled: config.sheets.enabled,
    url: config.sheets.url,
    lastSync: lastSheetSync,
    lastError: lastSheetError,
  });
});

app.post('/api/sheets-config', (req, res) => {
  const { enabled, url } = req.body;
  if (enabled !== undefined) config.sheets.enabled = !!enabled;
  if (url !== undefined) config.sheets.url = String(url).trim();
  try {
    saveSettings({ sheets: config.sheets });
  } catch (e) {
    console.error('Sheets 설정 저장 실패:', e.message);
  }
  res.json({ enabled: config.sheets.enabled, url: config.sheets.url });
});

// 연결 테스트 (Apps Script에 ping)
app.post('/api/sheets/test', async (req, res) => {
  try {
    const result = await postToSheets({ action: 'ping' });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// 전체(주간 점수 + 명렬표) 동기화
app.post('/api/sheets/sync', async (req, res) => {
  try {
    const weekly = await buildWeekly(req.body || {});
    const { from, to } = weekly;
    const payload = {
      action: 'syncWeekly',
      from,
      to,
      dates: weekly.dates,
      students: weekly.students.map((s) => ({
        number: s.student_no ?? '',
        name: s.name ?? '',
        days: s.days,
        total: s.total,
        ontime: s.ontime,
        late: s.late,
        absent: s.absent,
      })),
    };
    const result = await postToSheets(payload, 15000);
    lastSheetSync = new Date().toISOString();
    lastSheetError = null;
    res.json({ ok: true, from, to, count: weekly.students.length, result });
  } catch (e) {
    lastSheetError = e.message;
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ===== 🌐 공공데이터 설정 / 조회 =====
app.get('/api/public-config', (req, res) => {
  const pd = config.publicData;
  res.json({
    serviceKey: pd.serviceKey,
    holidays: pd.holidays, // { enabled, key }
    air: pd.air, // { key }
    weather: pd.weather, // { key }
    airweather: pd.airweather, // { enabled, sido, nx, ny }
    hasKey: !!(holidayKey() || airKey() || weatherKey()),
    hasHolidayKey: !!holidayKey(),
    hasAirKey: !!airKey(),
    hasWeatherKey: !!weatherKey(),
  });
});

app.post('/api/public-config', (req, res) => {
  const b = req.body || {};
  const pd = config.publicData;
  if (b.serviceKey !== undefined) pd.serviceKey = String(b.serviceKey).trim();
  if (b.holidayKey !== undefined) pd.holidays.key = String(b.holidayKey).trim();
  if (b.airApiKey !== undefined) pd.air.key = String(b.airApiKey).trim();
  if (b.weatherKey !== undefined) pd.weather.key = String(b.weatherKey).trim();
  if (b.holidaysEnabled !== undefined) pd.holidays.enabled = !!b.holidaysEnabled;
  if (b.airEnabled !== undefined) pd.airweather.enabled = !!b.airEnabled;
  if (b.sido !== undefined) pd.airweather.sido = String(b.sido).trim() || '서울';
  if (b.nx !== undefined && b.nx !== '') pd.airweather.nx = Number(b.nx);
  if (b.ny !== undefined && b.ny !== '') pd.airweather.ny = Number(b.ny);
  holidayCache.clear(); // 키/설정 바뀌면 캐시 무효화
  try {
    saveSettings({ publicData: pd });
  } catch (e) {
    console.error('공공데이터 설정 저장 실패:', e.message);
  }
  res.json({
    ok: true,
    holidays: pd.holidays,
    air: pd.air,
    weather: pd.weather,
    airweather: pd.airweather,
    hasHolidayKey: !!holidayKey(),
    hasAirKey: !!airKey(),
    hasWeatherKey: !!weatherKey(),
  });
});

// 미세먼지 + 날씨 + 야외활동 권장 (체육/출석 화면 위젯)
app.get('/api/air-weather', async (req, res) => {
  if (!airKey() && !weatherKey())
    return res.status(400).json({ error: '미세먼지/날씨 인증키가 설정되지 않았습니다.' });
  const [air, wx] = await Promise.allSettled([
    airKey() ? fetchAir() : Promise.reject(new Error('미세먼지 인증키 없음')),
    weatherKey() ? fetchWeather() : Promise.reject(new Error('날씨 인증키 없음')),
  ]);
  const a = air.status === 'fulfilled' ? air.value : {};
  const w = wx.status === 'fulfilled' ? wx.value : {};
  const grade = pmGrade(a.pm10, a.pm25);
  const reasons = [];
  let outdoor = true;
  if (grade === '나쁨' || grade === '매우나쁨') {
    outdoor = false;
    reasons.push(`미세먼지 ${grade}`);
  }
  if (w.pty > 0) {
    outdoor = false;
    reasons.push(PTY_LABEL[w.pty] || '강수');
  }
  if (w.temp != null && w.temp >= 33) {
    outdoor = false;
    reasons.push('폭염');
  }
  if (w.temp != null && w.temp <= -12) {
    outdoor = false;
    reasons.push('한파');
  }
  res.json({
    ...a,
    ...w,
    ptyLabel: w.pty != null ? PTY_LABEL[w.pty] || '-' : null,
    pmGrade: grade,
    outdoor,
    reasons,
    airError: air.status === 'rejected' ? String(air.reason?.message || air.reason) : null,
    weatherError: wx.status === 'rejected' ? String(wx.reason?.message || wx.reason) : null,
  });
});

// ===== 🏫 NEIS 설정 / 학교검색 / 급식 =====
app.get('/api/neis-config', (req, res) => {
  const n = config.neis;
  res.json({
    key: n.key,
    hasKey: !!n.key,
    atptCode: n.atptCode,
    schoolCode: n.schoolCode,
    schoolName: n.schoolName,
    meal: n.meal,
    schedule: n.schedule,
  });
});

app.post('/api/neis-config', (req, res) => {
  const n = config.neis;
  const b = req.body || {};
  if (b.key !== undefined) n.key = String(b.key).trim();
  if (b.atptCode !== undefined) n.atptCode = String(b.atptCode).trim();
  if (b.schoolCode !== undefined) n.schoolCode = String(b.schoolCode).trim();
  if (b.schoolName !== undefined) n.schoolName = String(b.schoolName).trim();
  if (b.mealEnabled !== undefined) n.meal.enabled = !!b.mealEnabled;
  if (b.scheduleEnabled !== undefined) n.schedule.enabled = !!b.scheduleEnabled;
  try {
    saveSettings({ neis: n });
  } catch (e) {
    console.error('NEIS 설정 저장 실패:', e.message);
  }
  res.json({ ok: true, hasKey: !!n.key, atptCode: n.atptCode, schoolCode: n.schoolCode, schoolName: n.schoolName, meal: n.meal, schedule: n.schedule });
});

// 나이스 인증키 단독 유효성 검증 API
app.post('/api/neis/test-key', async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: '인증키를 입력해 주세요.' });
  try {
    // 입력된 키를 사용하여 나이스 학교 정보 검색 API에 단순 테스트 검색(서울 지역)을 시도합니다.
    const q = new URLSearchParams({ KEY: key, Type: 'json', pIndex: 1, pSize: 1, SCHUL_NM: '서울' }).toString();
    const data = await fetchJson(`https://open.neis.go.kr/hub/schoolInfo?${q}`);
    
    // 응답 결과 확인
    const top = data['schoolInfo'];
    if (!top) {
      const code = data?.RESULT?.CODE;
      if (code === 'INFO-200') {
        // 데이터는 존재하지 않지만(INFO-200) 인증키 자체는 정상 통과된 상태입니다.
        return res.json({ ok: true, message: '인증키가 유효합니다. 정상적으로 작동합니다.' });
      }
      if (code && code !== 'INFO-000') {
        // 에러 코드가 리턴된 경우 (예: 인증키가 유효하지 않거나 일시적 오류)
        return res.status(400).json({ ok: false, error: `${code} ${data?.RESULT?.MESSAGE || ''}` });
      }
    }
    res.json({ ok: true, message: '인증키 검증에 성공했습니다. 정상적으로 작동합니다!' });
  } catch (e) {
    // 네트워크 장애 혹은 fetchJson 내부에서 발생한 HTML 에러 등을 리턴합니다.
    res.status(502).json({ ok: false, error: e.message });
  }
});

// 학교명으로 교육청코드·학교코드 찾기
app.get('/api/neis/school-search', async (req, res) => {
  if (!config.neis.key) return res.status(400).json({ error: 'NEIS 인증키가 설정되지 않았습니다.' });
  try {
    const rows = await neisFetch('schoolInfo', { SCHUL_NM: req.query.name || '', pSize: 50 });
    res.json(
      rows.map((r) => ({
        atptCode: r.ATPT_OFCDC_SC_CODE,
        schoolCode: r.SD_SCHUL_CODE,
        name: r.SCHUL_NM,
        kind: r.SCHUL_KND_SC_NM,
        addr: r.ORG_RDNMA,
      }))
    );
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 급식 식단 (?date=YYYY-MM-DD, 기본 오늘)
app.get('/api/neis/meal', async (req, res) => {
  const n = config.neis;
  if (!n.key || !n.atptCode || !n.schoolCode)
    return res.status(400).json({ error: 'NEIS 인증키·학교 설정이 필요합니다.' });
  const date = req.query.date || new Date().toLocaleDateString('sv-SE');
  try {
    const rows = await neisFetch('mealServiceDietInfo', {
      ATPT_OFCDC_SC_CODE: n.atptCode,
      SD_SCHUL_CODE: n.schoolCode,
      MLSV_YMD: date.replace(/-/g, ''),
    });
    const meals = rows.map((r) => {
      const dishes = parseDish(r.DDISH_NM);
      const set = new Set();
      dishes.forEach((d) => d.allergens.forEach((a) => set.add(a)));
      return {
        type: r.MMEAL_SC_NM,
        dishes,
        calorie: r.CAL_INFO,
        allergens: [...set].sort((a, b) => a - b).map((a) => `${a}.${ALLERGY[a] || a}`),
      };
    });
    res.json({ date, meals });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ===== 📅 오늘 정보 통합 (출석 후 학생에게 보여줄 급식·학사일정·날씨·미세먼지) =====
app.get('/api/today-info', async (req, res) => {
  const date = new Date().toLocaleDateString('sv-SE');
  const out = { date, meal: null, schedule: null, weather: null };
  const tasks = [];

  // 오늘 급식
  if (config.neis.meal.enabled && config.neis.key && config.neis.schoolCode) {
    tasks.push(
      (async () => {
        const rows = await neisFetch('mealServiceDietInfo', {
          ATPT_OFCDC_SC_CODE: config.neis.atptCode,
          SD_SCHUL_CODE: config.neis.schoolCode,
          MLSV_YMD: date.replace(/-/g, ''),
        });
        const meals = rows.map((r) => {
          const dishes = parseDish(r.DDISH_NM);
          const set = new Set();
          dishes.forEach((d) => d.allergens.forEach((a) => set.add(a)));
          return { type: r.MMEAL_SC_NM, dishes, allergens: [...set].sort((a, b) => a - b).map((a) => `${a}.${ALLERGY[a] || a}`) };
        });
        const lunch = meals.find((m) => /중식/.test(m.type)) || meals[0];
        if (lunch) out.meal = { type: lunch.type, items: lunch.dishes.map((d) => d.name), allergens: lunch.allergens };
      })()
    );
  }
  // 오늘 학사일정
  if (config.neis.schedule.enabled && config.neis.key && config.neis.schoolCode) {
    tasks.push(
      (async () => {
        const sch = await fetchNeisSchedule(date, date);
        out.schedule = { event: sch.events[date] || null, off: sch.off[date] || null };
      })()
    );
  }
  // 날씨 + 미세먼지
  if (config.publicData.airweather.enabled && (airKey() || weatherKey())) {
    tasks.push(
      (async () => {
        const [air, wx] = await Promise.allSettled([
          airKey() ? fetchAir() : Promise.reject(new Error('no air key')),
          weatherKey() ? fetchWeather() : Promise.reject(new Error('no weather key')),
        ]);
        const a = air.status === 'fulfilled' ? air.value : {};
        const w = wx.status === 'fulfilled' ? wx.value : {};
        const grade = pmGrade(a.pm10, a.pm25);
        const reasons = [];
        let outdoor = true;
        if (grade === '나쁨' || grade === '매우나쁨') {
          outdoor = false;
          reasons.push(`미세먼지 ${grade}`);
        }
        if (w.pty > 0) {
          outdoor = false;
          reasons.push(PTY_LABEL[w.pty] || '강수');
        }
        if (w.temp != null && w.temp >= 33) {
          outdoor = false;
          reasons.push('폭염');
        }
        if (w.temp != null && w.temp <= -12) {
          outdoor = false;
          reasons.push('한파');
        }
        out.weather = {
          temp: w.temp,
          ptyLabel: w.pty != null ? PTY_LABEL[w.pty] || '-' : null,
          pm10: a.pm10,
          pm25: a.pm25,
          pmGrade: grade,
          outdoor,
          reasons,
        };
      })()
    );
  }

  await Promise.allSettled(tasks); // 일부 실패해도 가능한 정보만 반환
  res.json(out);
});

// 하드웨어 없이 카드 태그 흉내 (테스트용)
app.post('/api/simulate', (req, res) => {
  const uid = req.body.uid || 'TEST' + Math.floor(Math.random() * 100000);
  reader.simulate(uid);
  res.json({ ok: true, uid });
});

const PORT = process.env.NFC_PORT || config.server?.port || 3000;
app.listen(PORT, () => {
  console.log(`\n=== CR-100 출석 프로그램 실행 중 ===`);
  console.log(`브라우저에서 열기:  http://localhost:${PORT}`);
  console.log(`리더기 포트:        ${config.serial.port} @ ${config.serial.baudRate} bps\n`);
});
