// SQLite 데이터베이스 (Node.js 내장 node:sqlite 사용)
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 배포(.exe) 시에는 쓰기 가능한 사용자 데이터 폴더(NFC_DATA_DIR)를 사용,
// 개발 시에는 프로젝트의 data 폴더를 사용
const DATA_DIR = process.env.NFC_DATA_DIR || join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, 'attendance.db');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    card_uid   TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    student_no TEXT,
    grade      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    card_uid   TEXT NOT NULL,
    student_id INTEGER,
    name       TEXT,
    tapped_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS physical_records (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id    INTEGER NOT NULL,
    activity_type TEXT NOT NULL,
    score         INTEGER NOT NULL,
    recorded_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (tapped_at);
  CREATE INDEX IF NOT EXISTS idx_physical_records_date ON physical_records (recorded_at);

  CREATE TABLE IF NOT EXISTS books (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    card_uid   TEXT UNIQUE NOT NULL,
    title      TEXT NOT NULL,
    author     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS loans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id     INTEGER NOT NULL,
    student_id  INTEGER NOT NULL,
    borrowed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    returned_at TEXT,
    rating      INTEGER,
    review      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_loans_book ON loans (book_id);
  CREATE INDEX IF NOT EXISTS idx_loans_student ON loans (student_id);

  CREATE TABLE IF NOT EXISTS shuttle_records (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    laps       INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS stations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    card_uid   TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS circuit_records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id   INTEGER NOT NULL,
    student_id   INTEGER NOT NULL,
    duration_sec INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_circuit_student ON circuit_records (student_id);

  /* ===== 🔬 지능형 과학실 테이블 추가 ===== */
  CREATE TABLE IF NOT EXISTS science_stations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_uid    TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    zone        TEXT,
    mission     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS science_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id  INTEGER NOT NULL,
    student_id  INTEGER NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(station_id) REFERENCES science_stations(id) ON DELETE CASCADE,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_science_student ON science_records (student_id);

  CREATE TABLE IF NOT EXISTS science_tools (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    card_uid     TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    category     TEXT,
    safety_rules TEXT,
    location     TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS science_tool_loans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id     INTEGER NOT NULL,
    student_id  INTEGER NOT NULL,
    borrowed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    returned_at TEXT,
    FOREIGN KEY(tool_id) REFERENCES science_tools(id) ON DELETE CASCADE,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sci_loans_tool ON science_tool_loans (tool_id);
`);

// 마이그레이션: 감정(mood) 컬럼 추가 (기존 DB 대응)
const attCols = db.prepare('PRAGMA table_info(attendance)').all();
if (!attCols.some((c) => c.name === 'mood')) {
  db.exec('ALTER TABLE attendance ADD COLUMN mood TEXT');
}

// 마이그레이션: 칭찬 포인트(points) 컬럼 추가 (기존 DB 대응)
const studentCols = db.prepare('PRAGMA table_info(students)').all();
if (!studentCols.some((c) => c.name === 'points')) {
  db.exec('ALTER TABLE students ADD COLUMN points INTEGER DEFAULT 0');
}

// 마이그레이션: 비밀번호(password) 컬럼 추가
if (!studentCols.some((c) => c.name === 'password')) {
  db.exec('ALTER TABLE students ADD COLUMN password TEXT');
}

// 마이그레이션: 출석 점수(score)·상태(status) 컬럼 추가 (정시/지각 점수 기능)
if (!attCols.some((c) => c.name === 'score')) {
  db.exec('ALTER TABLE attendance ADD COLUMN score INTEGER');
}
if (!attCols.some((c) => c.name === 'status')) {
  db.exec('ALTER TABLE attendance ADD COLUMN status TEXT');
}

// ---- 학생 ----
export function listStudents() {
  return db.prepare('SELECT * FROM students ORDER BY name').all();
}

export function getStudentByCard(cardUid) {
  return db.prepare('SELECT * FROM students WHERE card_uid = ?').get(cardUid);
}

export function getStudentById(id) {
  return db.prepare('SELECT * FROM students WHERE id = ?').get(id);
}

export function addStudent({ card_uid, name = '', student_no = null, grade = null }) {
  const stmt = db.prepare(
    'INSERT INTO students (card_uid, name, student_no, grade) VALUES (?, ?, ?, ?)'
  );
  // 개인정보 없이 번호만으로 등록 가능: 이름이 없으면 빈 문자열로 저장
  const info = stmt.run(card_uid, name ?? '', student_no || null, grade || null);
  return db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid);
}

export function updateStudent(id, { name, student_no, grade }) {
  db.prepare('UPDATE students SET name = ?, student_no = ?, grade = ? WHERE id = ?').run(
    name,
    student_no ?? null,
    grade ?? null,
    id
  );
  return db.prepare('SELECT * FROM students WHERE id = ?').get(id);
}

export function deleteStudent(id) {
  db.prepare('DELETE FROM students WHERE id = ?').run(id);
}

// ---- 출석 ----
export function recordAttendance(cardUid, { score = null, status = null } = {}) {
  const student = getStudentByCard(cardUid);
  const stmt = db.prepare(
    'INSERT INTO attendance (card_uid, student_id, name, score, status) VALUES (?, ?, ?, ?, ?)'
  );
  const info = stmt.run(cardUid, student?.id ?? null, student?.name ?? null, score, status);
  return db.prepare('SELECT * FROM attendance WHERE id = ?').get(info.lastInsertRowid);
}

// 감정(오늘의 기분) 저장
export function setMood(attendanceId, mood) {
  db.prepare('UPDATE attendance SET mood = ? WHERE id = ?').run(mood, attendanceId);
  return db.prepare('SELECT * FROM attendance WHERE id = ?').get(attendanceId);
}

// 마지막 출석 시각 (디바운스용)
export function lastAttendanceFor(cardUid) {
  return db
    .prepare('SELECT tapped_at FROM attendance WHERE card_uid = ? ORDER BY id DESC LIMIT 1')
    .get(cardUid);
}

// 특정 날짜(YYYY-MM-DD)의 출석. date 미지정 시 전체.
export function listAttendance(date = null) {
  const base = `SELECT a.*, s.student_no AS student_no
                  FROM attendance a
                  LEFT JOIN students s ON s.id = a.student_id`;
  if (date) {
    return db.prepare(base + ' WHERE date(a.tapped_at) = ? ORDER BY a.tapped_at DESC').all(date);
  }
  return db.prepare(base + ' ORDER BY a.tapped_at DESC LIMIT 500').all();
}

// ---- 대시보드 통계 ----
export function dashboardStats(date) {
  const totalStudents = db.prepare('SELECT COUNT(*) AS c FROM students').get().c;

  const present = db
    .prepare(
      `SELECT s.id, s.name, s.student_no, s.grade,
              MIN(a.tapped_at) AS first_tap,
              a.status AS status, a.score AS score
         FROM students s
         JOIN attendance a ON a.student_id = s.id
        WHERE date(a.tapped_at) = ?
        GROUP BY s.id
        ORDER BY first_tap`
    )
    .all(date);
  const ontimeCount = present.filter((p) => p.status === 'ontime').length;
  const lateCount = present.filter((p) => p.status === 'late').length;
  const todayScore = present.reduce((s, p) => s + (p.score ?? 0), 0);

  // 그 날 감정 분포
  const moodRows = db
    .prepare(
      `SELECT mood, COUNT(*) AS c FROM attendance
        WHERE mood IS NOT NULL AND date(tapped_at) = ?
        GROUP BY mood`
    )
    .all(date);
  const moods = {};
  for (const r of moodRows) moods[r.mood] = r.c;

  const presentIds = new Set(present.map((p) => p.id));
  const absent = db
    .prepare('SELECT id, name, student_no, grade FROM students ORDER BY name')
    .all()
    .filter((s) => !presentIds.has(s.id));

  // 미등록 카드 태그 수
  const unknownTaps = db
    .prepare(
      `SELECT COUNT(*) AS c FROM attendance
        WHERE student_id IS NULL AND date(tapped_at) = ?`
    )
    .get(date).c;

  // 최근 7일 일별 출석 인원
  const rows = db
    .prepare(
      `SELECT date(tapped_at) AS d, COUNT(DISTINCT student_id) AS c
         FROM attendance
        WHERE student_id IS NOT NULL
          AND date(tapped_at) BETWEEN date(?, '-6 days') AND date(?)
        GROUP BY date(tapped_at)`
    )
    .all(date, date);
  const byDay = new Map(rows.map((r) => [r.d, r.c]));
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const d = db.prepare("SELECT date(?, ?) AS d").get(date, `-${i} days`).d;
    daily.push({ date: d, count: byDay.get(d) ?? 0 });
  }

  return {
    date,
    totalStudents,
    presentCount: present.length,
    absentCount: absent.length,
    ontimeCount,
    lateCount,
    todayScore,
    rate: totalStudents ? Math.round((present.length / totalStudents) * 100) : 0,
    unknownTaps,
    present,
    absent,
    daily,
    moods,
  };
}

// 출석 엑셀(CSV) 내보내기용
export function listAttendanceExport(date = null) {
  const base = `SELECT a.name AS name, s.student_no AS student_no, a.card_uid AS card_uid,
                       a.tapped_at AS tapped_at, a.status AS status, a.score AS score
                  FROM attendance a
                  LEFT JOIN students s ON s.id = a.student_id`;
  if (date) {
    return db.prepare(base + ' WHERE date(a.tapped_at) = ? ORDER BY a.tapped_at DESC').all(date);
  }
  return db.prepare(base + ' ORDER BY a.tapped_at DESC LIMIT 1000').all();
}

// 주간 점수 기록
export function weeklyScores(from, to) {
  const dates = [];
  let cursor = from;
  for (let i = 0; i < 31; i++) {
    dates.push(cursor);
    if (cursor === to) break;
    cursor = db.prepare("SELECT date(?, '+1 day') AS d").get(cursor).d;
  }

  const students = db
    .prepare(
      `SELECT id, name, student_no, grade FROM students
        ORDER BY CASE WHEN student_no GLOB '*[0-9]*' THEN CAST(student_no AS INTEGER) END, name`
    )
    .all();

  const rows = db
    .prepare(
      `SELECT student_id AS sid, date(tapped_at) AS d,
              MIN(tapped_at) AS first_tap, status, score
         FROM attendance
        WHERE student_id IS NOT NULL AND date(tapped_at) BETWEEN ? AND ?
        GROUP BY student_id, date(tapped_at)`
    )
    .all(from, to);

  const grid = new Map();
  for (const r of rows) {
    if (!grid.has(r.sid)) grid.set(r.sid, {});
    grid.get(r.sid)[r.d] = { status: r.status, score: r.score ?? 0 };
  }

  const result = students.map((s) => {
    const days = grid.get(s.id) || {};
    let total = 0;
    let ontime = 0;
    let late = 0;
    let absent = 0;
    for (const d of dates) {
      const e = days[d];
      if (!e) {
        absent++;
      } else {
        total += e.score ?? 0;
        if (e.status === 'ontime') ontime++;
        else late++;
      }
    }
    return { id: s.id, name: s.name, student_no: s.student_no, grade: s.grade, days, total, ontime, late, absent };
  });

  return { from, to, dates, students: result };
}

// ---- 칭찬 포인트 조작 ----
export function updateStudentPoints(id, points) {
  db.prepare('UPDATE students SET points = ? WHERE id = ?').run(points, id);
  return db.prepare('SELECT * FROM students WHERE id = ?').get(id);
}

export function adjustStudentPoints(id, delta) {
  db.prepare('UPDATE students SET points = points + ? WHERE id = ?').run(delta, id);
  return db.prepare('SELECT * FROM students WHERE id = ?').get(id);
}

// ===== 감정 출석부 통계 =====
const POSITIVE_MOODS = ['great', 'good'];
const NEGATIVE_MOODS = ['tired', 'sad', 'angry'];
const MOOD_SCORE = { great: 2, good: 1, soso: 0, tired: -1, sad: -1, angry: -2 };

export function moodStats(from, to) {
  const rows = db
    .prepare(
      `SELECT a.mood AS mood, date(a.tapped_at) AS d, a.student_id AS sid, s.name AS name
         FROM attendance a
         LEFT JOIN students s ON s.id = a.student_id
        WHERE a.mood IS NOT NULL AND date(a.tapped_at) BETWEEN ? AND ?`
    )
    .all(from, to);

  const byMood = {};
  let scoreSum = 0;
  for (const r of rows) {
    byMood[r.mood] = (byMood[r.mood] ?? 0) + 1;
    scoreSum += MOOD_SCORE[r.mood] ?? 0;
  }
  const total = rows.length;
  const positive = POSITIVE_MOODS.reduce((s, k) => s + (byMood[k] ?? 0), 0);
  const negative = NEGATIVE_MOODS.reduce((s, k) => s + (byMood[k] ?? 0), 0);
  const neutral = total - positive - negative;
  const score = total ? scoreSum / total : 0;

  const dailyMap = new Map();
  for (const r of rows) {
    if (!dailyMap.has(r.d)) dailyMap.set(r.d, {});
    const m = dailyMap.get(r.d);
    m[r.mood] = (m[r.mood] ?? 0) + 1;
  }
  const daily = [];
  let cursor = from;
  for (let i = 0; i < 366; i++) {
    const byMoodDay = dailyMap.get(cursor) ?? {};
    const dayTotal = Object.values(byMoodDay).reduce((a, b) => a + b, 0);
    daily.push({ date: cursor, byMood: byMoodDay, total: dayTotal });
    if (cursor === to) break;
    cursor = db.prepare("SELECT date(?, '+1 day') AS d").get(cursor).d;
  }

  const concernRows = db
    .prepare(
      `SELECT s.id AS id, s.name AS name, a.mood AS mood, COUNT(*) AS c
         FROM attendance a
         JOIN students s ON s.id = a.student_id
        WHERE a.mood IN ('tired','sad','angry') AND date(a.tapped_at) BETWEEN ? AND ?
        GROUP BY s.id, a.mood`
    )
    .all(from, to);
  const concernMap = new Map();
  for (const r of concernRows) {
    if (!concernMap.has(r.id)) concernMap.set(r.id, { id: r.id, name: r.name, total: 0, byMood: {} });
    const e = concernMap.get(r.id);
    e.byMood[r.mood] = r.c;
    e.total += r.c;
  }
  const concern = [...concernMap.values()].sort((a, b) => b.total - a.total);

  return {
    from,
    to,
    total,
    byMood,
    positive,
    negative,
    neutral,
    positiveRatio: total ? Math.round((positive / total) * 100) : 0,
    score: Math.round(score * 100) / 100,
    weather: weatherFromScore(score, total),
    daily,
    concern,
  };
}

export function recentMoods(studentId, n = 5) {
  return db
    .prepare(
      'SELECT mood FROM attendance WHERE student_id = ? AND mood IS NOT NULL ORDER BY tapped_at DESC LIMIT ?'
    )
    .all(studentId, n)
    .map((r) => r.mood)
    .reverse();
}

function weatherFromScore(score, total) {
  if (!total) return { emoji: '🌫️', label: '기록 없음' };
  if (score >= 1.0) return { emoji: '☀️', label: '아주 맑음' };
  if (score >= 0.3) return { emoji: '🌤️', label: '맑음' };
  if (score >= -0.3) return { emoji: '⛅', label: '보통' };
  if (score >= -1.0) return { emoji: '🌧️', label: '흐림' };
  return { emoji: '⛈️', label: '폭풍우' };
}

// ===== 도서 =====
export function listBooks() {
  return db
    .prepare(
      `SELECT b.*,
              l.id AS active_loan_id,
              s.name AS borrower_name
         FROM books b
         LEFT JOIN loans l ON l.book_id = b.id AND l.returned_at IS NULL
         LEFT JOIN students s ON s.id = l.student_id
        ORDER BY b.title`
    )
    .all();
}

export function getBookByCard(cardUid) {
  return db.prepare('SELECT * FROM books WHERE card_uid = ?').get(cardUid);
}

export function addBook({ card_uid, title, author = null }) {
  const info = db
    .prepare('INSERT INTO books (card_uid, title, author) VALUES (?, ?, ?)')
    .run(card_uid, title, author);
  return db.prepare('SELECT * FROM books WHERE id = ?').get(info.lastInsertRowid);
}

export function deleteBook(id) {
  db.prepare('DELETE FROM books WHERE id = ?').run(id);
}

// ===== 대여 / 반납 =====
export function activeLoanForBook(bookId) {
  return db
    .prepare('SELECT * FROM loans WHERE book_id = ? AND returned_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(bookId);
}

export function createLoan(bookId, studentId) {
  const info = db
    .prepare('INSERT INTO loans (book_id, student_id) VALUES (?, ?)')
    .run(bookId, studentId);
  return db.prepare('SELECT * FROM loans WHERE id = ?').get(info.lastInsertRowid);
}

export function returnLoan(loanId) {
  db.prepare("UPDATE loans SET returned_at = datetime('now','localtime') WHERE id = ?").run(loanId);
  return db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
}

export function setLoanReview(loanId, rating, review) {
  db.prepare('UPDATE loans SET rating = ?, review = ? WHERE id = ?').run(
    rating ?? null,
    review ?? null,
    loanId
  );
  return db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
}

export function studentReadingRecord(studentId) {
  return db
    .prepare(
      `SELECT l.id, l.borrowed_at, l.returned_at, l.rating, l.review,
              b.title, b.author
         FROM loans l
         JOIN books b ON b.id = l.book_id
        WHERE l.student_id = ? AND l.returned_at IS NOT NULL
        ORDER BY l.returned_at DESC`
    )
    .all(studentId);
}

export function readingStats(goalBooks = 100) {
  const totalRead = db
    .prepare('SELECT COUNT(*) AS c FROM loans WHERE returned_at IS NOT NULL')
    .get().c;
  const currentlyOut = db
    .prepare('SELECT COUNT(*) AS c FROM loans WHERE returned_at IS NULL')
    .get().c;
  const totalBooks = db.prepare('SELECT COUNT(*) AS c FROM books').get().c;

  const ranking = db
    .prepare(
      `SELECT s.id, s.name, COUNT(l.id) AS read_count
         FROM students s
         JOIN loans l ON l.student_id = s.id AND l.returned_at IS NOT NULL
        GROUP BY s.id
        ORDER BY read_count DESC, s.name
        LIMIT 10`
    )
    .all();

  const recentReviews = db
    .prepare(
      `SELECT l.rating, l.review, l.returned_at,
              b.title, s.name AS student_name
         FROM loans l
         JOIN books b ON b.id = l.book_id
         JOIN students s ON s.id = l.student_id
        WHERE l.review IS NOT NULL AND l.review <> ''
        ORDER BY l.returned_at DESC
        LIMIT 8`
    )
    .all();

  return {
    totalRead,
    currentlyOut,
    totalBooks,
    goalBooks,
    percent: goalBooks ? Math.min(100, Math.round((totalRead / goalBooks) * 100)) : 0,
    ranking,
    recentReviews,
  };
}

// ===== 🏃 셔틀런 =====
export function addShuttleRecord(studentId, laps) {
  const info = db
    .prepare('INSERT INTO shuttle_records (student_id, laps) VALUES (?, ?)')
    .run(studentId, laps);
  return db.prepare('SELECT * FROM shuttle_records WHERE id = ?').get(info.lastInsertRowid);
}

export function shuttleBest(studentId) {
  return db.prepare('SELECT MAX(laps) AS m FROM shuttle_records WHERE student_id = ?').get(studentId).m ?? 0;
}

export function shuttleRecords(studentId = null) {
  if (studentId) {
    return db
      .prepare(
        `SELECT r.*, s.name FROM shuttle_records r JOIN students s ON s.id = r.student_id
          WHERE r.student_id = ? ORDER BY r.created_at`
      )
      .all(studentId);
  }
  return db
    .prepare(
      `SELECT r.*, s.name FROM shuttle_records r JOIN students s ON s.id = r.student_id
        ORDER BY r.created_at DESC LIMIT 200`
    )
    .all();
}

export function shuttleLeaderboard() {
  return db
    .prepare(
      `SELECT s.id, s.name, MAX(r.laps) AS best, COUNT(r.id) AS attempts
         FROM students s JOIN shuttle_records r ON r.student_id = s.id
        GROUP BY s.id ORDER BY best DESC, s.name LIMIT 20`
    )
    .all();
}

// ===== 🏋️ 서킷 트레이닝 스테이션 =====
export function listStations() {
  return db.prepare('SELECT * FROM stations ORDER BY name').all();
}
export function getStationByCard(cardUid) {
  return db.prepare('SELECT * FROM stations WHERE card_uid = ?').get(cardUid);
}
export function addStation({ card_uid, name }) {
  const info = db.prepare('INSERT INTO stations (card_uid, name) VALUES (?, ?)').run(card_uid, name);
  return db.prepare('SELECT * FROM stations WHERE id = ?').get(info.lastInsertRowid);
}
export function deleteStation(id) {
  db.prepare('DELETE FROM stations WHERE id = ?').run(id);
}
export function addCircuitRecord(stationId, studentId, durationSec) {
  const info = db
    .prepare('INSERT INTO circuit_records (station_id, student_id, duration_sec) VALUES (?, ?, ?)')
    .run(stationId, studentId, durationSec);
  return db.prepare('SELECT * FROM circuit_records WHERE id = ?').get(info.lastInsertRowid);
}
export function circuitBest(stationId, studentId) {
  return db
    .prepare('SELECT MAX(duration_sec) AS m FROM circuit_records WHERE station_id = ? AND student_id = ?')
    .get(stationId, studentId).m ?? 0;
}
export function circuitRecords(studentId = null, stationId = null) {
  let sql = `SELECT c.*, s.name AS student_name, st.name AS station_name
               FROM circuit_records c
               JOIN students s ON s.id = c.student_id
               JOIN stations st ON st.id = c.station_id`;
  const where = [];
  const args = [];
  if (studentId) { where.push('c.student_id = ?'); args.push(studentId); }
  if (stationId) { where.push('c.station_id = ?'); args.push(stationId); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY c.created_at DESC LIMIT 200';
  return db.prepare(sql).all(...args);
}
export function circuitGrowth(studentId) {
  const rows = db
    .prepare(
      `SELECT c.station_id, st.name AS station_name, c.duration_sec, c.created_at
         FROM circuit_records c JOIN stations st ON st.id = c.station_id
        WHERE c.student_id = ? ORDER BY c.created_at`
    )
    .all(studentId);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.station_id))
      map.set(r.station_id, { stationId: r.station_id, name: r.station_name, points: [] });
    map.get(r.station_id).points.push({ at: r.created_at, sec: r.duration_sec });
  }
  return [...map.values()];
}

// ===== 🔬 지능형 과학실 (Smart Science Lab) =====
export function listScienceStations() {
  return db.prepare('SELECT * FROM science_stations ORDER BY name').all();
}
export function getScienceStationByCard(cardUid) {
  return db.prepare('SELECT * FROM science_stations WHERE card_uid = ?').get(cardUid);
}
export function addScienceStation({ card_uid, name, zone = '', mission = '' }) {
  const stmt = db.prepare(
    'INSERT INTO science_stations (card_uid, name, zone, mission) VALUES (?, ?, ?, ?)'
  );
  const info = stmt.run(card_uid, name, zone || '', mission || '');
  return db.prepare('SELECT * FROM science_stations WHERE id = ?').get(info.lastInsertRowid);
}
export function deleteScienceStation(id) {
  db.prepare('DELETE FROM science_stations WHERE id = ?').run(id);
}

export function recordScienceStationTap(stationId, studentId, note = '') {
  const stmt = db.prepare(
    'INSERT INTO science_records (station_id, student_id, note) VALUES (?, ?, ?)'
  );
  const info = stmt.run(stationId, studentId, note || '');
  return db.prepare('SELECT * FROM science_records WHERE id = ?').get(info.lastInsertRowid);
}

export function listScienceRecords(studentId = null, stationId = null) {
  let sql = `SELECT r.*, s.name AS student_name, s.student_no, st.name AS station_name, st.zone, st.mission
               FROM science_records r
               JOIN students s ON s.id = r.student_id
               JOIN science_stations st ON st.id = r.station_id`;
  const where = [];
  const args = [];
  if (studentId) { where.push('r.student_id = ?'); args.push(studentId); }
  if (stationId) { where.push('r.station_id = ?'); args.push(stationId); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY r.created_at DESC LIMIT 200';
  return db.prepare(sql).all(...args);
}

export function studentSciencePassport(studentId) {
  const allStations = listScienceStations();
  const completedRows = db
    .prepare(
      `SELECT station_id, COUNT(*) AS count, MAX(created_at) AS last_completed_at
         FROM science_records
        WHERE student_id = ?
        GROUP BY station_id`
    )
    .all(studentId);
  const completedMap = new Map(completedRows.map((r) => [r.station_id, r]));

  const passport = allStations.map((st) => {
    const rec = completedMap.get(st.id);
    return {
      stationId: st.id,
      name: st.name,
      zone: st.zone,
      mission: st.mission,
      completed: !!rec,
      count: rec?.count ?? 0,
      lastCompletedAt: rec?.last_completed_at ?? null,
    };
  });
  const total = allStations.length;
  const completedCount = passport.filter((p) => p.completed).length;
  return {
    studentId,
    total,
    completedCount,
    rate: total ? Math.round((completedCount / total) * 100) : 0,
    stations: passport,
  };
}

// ---- 지능형 과학실 교구 & 시약 안전 관리 ----
export function listScienceTools() {
  return db
    .prepare(
      `SELECT t.*,
              l.id AS active_loan_id,
              l.student_id AS borrower_student_id,
              s.name AS borrower_name,
              l.borrowed_at AS borrowed_at
         FROM science_tools t
         LEFT JOIN science_tool_loans l ON l.tool_id = t.id AND l.returned_at IS NULL
         LEFT JOIN students s ON s.id = l.student_id
        ORDER BY t.name`
    )
    .all();
}

export function getScienceToolByCard(cardUid) {
  return db.prepare('SELECT * FROM science_tools WHERE card_uid = ?').get(cardUid);
}

export function addScienceTool({ card_uid, name, category = '', safety_rules = '', location = '' }) {
  const stmt = db.prepare(
    'INSERT INTO science_tools (card_uid, name, category, safety_rules, location) VALUES (?, ?, ?, ?, ?)'
  );
  const info = stmt.run(card_uid, name, category || '', safety_rules || '', location || '');
  return db.prepare('SELECT * FROM science_tools WHERE id = ?').get(info.lastInsertRowid);
}

export function deleteScienceTool(id) {
  db.prepare('DELETE FROM science_tools WHERE id = ?').run(id);
}

export function activeLoanForScienceTool(toolId) {
  return db
    .prepare('SELECT * FROM science_tool_loans WHERE tool_id = ? AND returned_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(toolId);
}

export function borrowScienceTool(toolId, studentId) {
  const info = db
    .prepare('INSERT INTO science_tool_loans (tool_id, student_id) VALUES (?, ?)')
    .run(toolId, studentId);
  return db.prepare('SELECT * FROM science_tool_loans WHERE id = ?').get(info.lastInsertRowid);
}

export function returnScienceTool(loanId) {
  db.prepare("UPDATE science_tool_loans SET returned_at = datetime('now','localtime') WHERE id = ?").run(loanId);
  return db.prepare('SELECT * FROM science_tool_loans WHERE id = ?').get(loanId);
}

// ===== 💾 데이터 관리: 백업 · 통계 · 내보내기 · 초기화 =====
export function dataStats() {
  const c = (sql) => db.prepare(sql).get().c;
  return {
    students: c('SELECT COUNT(*) AS c FROM students'),
    attendance: c('SELECT COUNT(*) AS c FROM attendance'),
    moods: c('SELECT COUNT(*) AS c FROM attendance WHERE mood IS NOT NULL'),
    points: c('SELECT COUNT(*) AS c FROM students WHERE points <> 0'),
    books: c('SELECT COUNT(*) AS c FROM books'),
    loans: c('SELECT COUNT(*) AS c FROM loans'),
    stations: c('SELECT COUNT(*) AS c FROM stations'),
    shuttle: c('SELECT COUNT(*) AS c FROM shuttle_records'),
    circuit: c('SELECT COUNT(*) AS c FROM circuit_records'),
    scienceStations: c('SELECT COUNT(*) AS c FROM science_stations'),
    scienceRecords: c('SELECT COUNT(*) AS c FROM science_records'),
    scienceTools: c('SELECT COUNT(*) AS c FROM science_tools'),
    scienceLoans: c('SELECT COUNT(*) AS c FROM science_tool_loans'),
  };
}

export function backupTo(destPath) {
  const safe = destPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${safe}'`);
}

// ---- 항목별 엑셀(CSV) 내보내기용 행 ----
export function exportMoods() {
  return db
    .prepare(
      `SELECT s.student_no AS student_no, a.name AS name,
              date(a.tapped_at) AS d, a.tapped_at AS tapped_at, a.mood AS mood
         FROM attendance a
         LEFT JOIN students s ON s.id = a.student_id
        WHERE a.mood IS NOT NULL
        ORDER BY a.tapped_at DESC`
    )
    .all();
}

export function exportPoints() {
  return db
    .prepare(
      `SELECT student_no, name, grade, points FROM students
        ORDER BY CASE WHEN student_no GLOB '*[0-9]*' THEN CAST(student_no AS INTEGER) END, name`
    )
    .all();
}

export function exportLoans() {
  return db
    .prepare(
      `SELECT s.student_no AS student_no, s.name AS student_name,
              b.title AS title, b.author AS author,
              l.borrowed_at AS borrowed_at, l.returned_at AS returned_at,
              l.rating AS rating, l.review AS review
         FROM loans l
         JOIN books b ON b.id = l.book_id
         LEFT JOIN students s ON s.id = l.student_id
        ORDER BY l.borrowed_at DESC`
    )
    .all();
}

export function exportPhysical() {
  const shuttle = db
    .prepare(
      `SELECT s.student_no AS student_no, s.name AS name, '셔틀런' AS kind,
              r.laps AS value, '회' AS unit, r.created_at AS created_at
         FROM shuttle_records r JOIN students s ON s.id = r.student_id`
    )
    .all();
  const circuit = db
    .prepare(
      `SELECT s.student_no AS student_no, s.name AS name, st.name AS kind,
              c.duration_sec AS value, '초' AS unit, c.created_at AS created_at
         FROM circuit_records c
         JOIN students s ON s.id = c.student_id
         JOIN stations st ON st.id = c.station_id`
    )
    .all();
  return [...shuttle, ...circuit].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// 지능형 과학실 탐구 기록 + 교구 대여 이력 내보내기
export function exportScience() {
  const exploration = db
    .prepare(
      `SELECT s.student_no AS student_no, s.name AS student_name, '탐구스테이션' AS kind,
              st.name AS item_name, st.zone AS category, r.note AS note, r.created_at AS record_time
         FROM science_records r
         JOIN students s ON s.id = r.student_id
         JOIN science_stations st ON st.id = r.station_id`
    )
    .all();
  const toolLoans = db
    .prepare(
      `SELECT s.student_no AS student_no, s.name AS student_name, '교구대여' AS kind,
              t.name AS item_name, t.category AS category,
              '대여: ' || l.borrowed_at || CASE WHEN l.returned_at IS NOT NULL THEN ' / 반납: ' || l.returned_at ELSE ' (대여중)' END AS note,
              l.borrowed_at AS record_time
         FROM science_tool_loans l
         JOIN students s ON s.id = l.student_id
         JOIN science_tools t ON t.id = l.tool_id`
    )
    .all();
  return [...exploration, ...toolLoans].sort((a, b) => (a.record_time < b.record_time ? 1 : -1));
}

// ---- 초기화 ----
export function resetAttendance() {
  db.exec('DELETE FROM attendance');
}
export function resetMoods() {
  db.exec('UPDATE attendance SET mood = NULL');
}
export function resetPoints() {
  db.exec('UPDATE students SET points = 0');
}
export function resetLibraryRecords() {
  db.exec('DELETE FROM loans');
}
export function resetPhysicalRecords() {
  db.exec('DELETE FROM shuttle_records; DELETE FROM circuit_records; DELETE FROM physical_records;');
}
export function resetScienceRecords() {
  db.exec('DELETE FROM science_records; DELETE FROM science_tool_loans;');
}
export function resetAllRecords() {
  db.exec(`
    DELETE FROM attendance;
    DELETE FROM loans;
    DELETE FROM shuttle_records;
    DELETE FROM circuit_records;
    DELETE FROM physical_records;
    DELETE FROM science_records;
    DELETE FROM science_tool_loans;
    UPDATE students SET points = 0;
  `);
}
export function factoryReset() {
  db.exec(`
    DELETE FROM attendance;
    DELETE FROM loans;
    DELETE FROM shuttle_records;
    DELETE FROM circuit_records;
    DELETE FROM physical_records;
    DELETE FROM science_records;
    DELETE FROM science_tool_loans;
    DELETE FROM science_tools;
    DELETE FROM science_stations;
    DELETE FROM books;
    DELETE FROM stations;
    DELETE FROM students;
  `);
}

// ---- 수동 로그인 (비밀번호 및 학급 조회) ----
export function listGrades() {
  const rows = db.prepare("SELECT DISTINCT grade FROM students WHERE grade IS NOT NULL AND grade <> '' ORDER BY grade").all();
  return rows.map(r => r.grade);
}

export function listStudentsByGrade(grade) {
  return db.prepare("SELECT id, name, student_no, grade, (password IS NOT NULL) AS has_password, points FROM students WHERE grade = ? ORDER BY CASE WHEN student_no GLOB '*[0-9]*' THEN CAST(student_no AS INTEGER) END, name").all(grade);
}

export function setStudentPassword(id, plainPassword) {
  const hash = createHash('sha256').update(plainPassword).digest('hex');
  db.prepare('UPDATE students SET password = ? WHERE id = ?').run(hash, id);
  return db.prepare('SELECT id, name, student_no, grade, (password IS NOT NULL) AS has_password FROM students WHERE id = ?').get(id);
}

export function verifyStudentPassword(id, plainPassword) {
  const student = db.prepare('SELECT password FROM students WHERE id = ?').get(id);
  if (!student || !student.password) return false;
  const hash = createHash('sha256').update(plainPassword).digest('hex');
  return student.password === hash;
}

export default db;
