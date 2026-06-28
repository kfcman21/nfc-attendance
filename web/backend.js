/* ============================================================================
 * backend.js — 크롬북(브라우저) 전용 백엔드
 *
 * 원래 이 앱은 Node 서버(Express + serialport + SQLite)가 백엔드를 담당했지만,
 * 크롬북(ChromeOS)에는 Node가 없습니다. 그래서 이 파일이 브라우저 안에서
 * 같은 역할을 대신합니다 — app.js 는 거의 그대로 두고 동작합니다.
 *
 *   serialport   →  Web Serial API (Chrome 내장, CP210x 직접 인식)
 *   Express+SSE  →  window.fetch / EventSource 가로채기 (페이지 내부 이벤트 버스)
 *   SQLite 파일   →  sql.js(WASM SQLite) + IndexedDB 영구 저장
 *
 * app.js 보다 "먼저" 로드되어야 하며, fetch/EventSource 패치는 즉시 적용하고
 * 실제 처리(DB·리더기)는 준비될 때까지 내부에서 기다립니다.
 * ========================================================================== */
(() => {
  'use strict';

  // ---- 설정 (원래 config.json 에 해당) ----
  const CONFIG = {
    serial: { vendorId: 0x10c4, productId: 0xea60, baudRate: 9600 },
    attendance: { debounceSeconds: 5 },
    reading: { goalBooks: 100 },
  };
  const LS_BAUD = 'nfc.baudRate';
  function baudRate() { return Number(localStorage.getItem(LS_BAUD)) || CONFIG.serial.baudRate; }

  // ============================================================
  // 0. 준비 게이트 — app.js 가 일찍 fetch 해도 DB 준비까지 기다림
  // ============================================================
  let resolveReady;
  const readyPromise = new Promise((r) => (resolveReady = r));

  // ============================================================
  // 1. 이벤트 버스 (원래 SSE broadcast 대체)
  // ============================================================
  const esClients = new Set();
  function broadcast(event) {
    const data = JSON.stringify(event);
    for (const c of esClients) {
      try { c._emit(data); } catch {}
    }
  }

  class ShimEventSource {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      esClients.add(this);
      // 연결 직후 현재 상태 1회 전송 (원래 서버 동작과 동일)
      readyPromise.then(() => {
        this._emit(JSON.stringify({ type: 'status', ...reader.statusInfo }));
      });
    }
    _emit(data) { if (this.onmessage) this.onmessage({ data }); }
    close() { esClients.delete(this); }
  }
  window.EventSource = ShimEventSource;

  // ============================================================
  // 2. 데이터베이스 (sql.js + IndexedDB)
  // ============================================================
  const IDB_NAME = 'nfc-attendance';
  const IDB_STORE = 'kv';
  const IDB_KEY = 'sqlite-db';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const r = tx.objectStore(IDB_STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  let SQL = null;     // sql.js 모듈
  let rawDb = null;   // sql.js Database 인스턴스

  // 변경분을 IndexedDB 로 저장 (잦은 호출은 묶어서)
  let saveTimer = null;
  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 400);
  }
  async function persistNow() {
    if (!rawDb) return;
    try { await idbSet(IDB_KEY, rawDb.export()); } catch (e) { console.error('DB 저장 실패', e); }
  }
  window.addEventListener('pagehide', persistNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persistNow(); });

  // 로컬시각 'YYYY-MM-DD HH:MM:SS' (sql.js WASM 의 localtime 이 UTC 로 동작하는 문제 회피)
  function nowLocal() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // better-sqlite3 스타일(.prepare().get/all/run, .exec) 어댑터 → db.mjs 코드 거의 그대로 재사용
  function flat(args) {
    return args.map((v) => (v === undefined ? null : v));
  }
  const DB = {
    exec(sql) { rawDb.exec(sql); },
    prepare(sql) {
      return {
        get(...args) {
          const st = rawDb.prepare(sql);
          try { st.bind(flat(args)); return st.step() ? st.getAsObject() : undefined; }
          finally { st.free(); }
        },
        all(...args) {
          const st = rawDb.prepare(sql);
          const out = [];
          try { st.bind(flat(args)); while (st.step()) out.push(st.getAsObject()); }
          finally { st.free(); }
          return out;
        },
        run(...args) {
          rawDb.run(sql, flat(args));
          persistSoon();
          const r = rawDb.exec('SELECT last_insert_rowid() AS id');
          return { lastInsertRowid: r[0]?.values?.[0]?.[0], changes: rawDb.getRowsModified() };
        },
      };
    },
  };

  function initSchema() {
    DB.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_uid TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        student_no TEXT, grade TEXT, points INTEGER DEFAULT 0,
        created_at TEXT NOT NULL );
      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_uid TEXT NOT NULL, student_id INTEGER, name TEXT,
        mood TEXT, tapped_at TEXT NOT NULL );
      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (tapped_at);
      CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_uid TEXT UNIQUE NOT NULL, title TEXT NOT NULL, author TEXT, created_at TEXT NOT NULL );
      CREATE TABLE IF NOT EXISTS loans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        borrowed_at TEXT NOT NULL, returned_at TEXT, rating INTEGER, review TEXT );
      CREATE INDEX IF NOT EXISTS idx_loans_book ON loans (book_id);
      CREATE INDEX IF NOT EXISTS idx_loans_student ON loans (student_id);
      CREATE TABLE IF NOT EXISTS shuttle_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL, laps INTEGER NOT NULL, created_at TEXT NOT NULL );
      CREATE TABLE IF NOT EXISTS stations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_uid TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL );
      CREATE TABLE IF NOT EXISTS circuit_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        station_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        duration_sec INTEGER NOT NULL, created_at TEXT NOT NULL );
      CREATE INDEX IF NOT EXISTS idx_circuit_student ON circuit_records (student_id);
    `);
  }

  // ---------- DB 함수 (src/db.mjs 포팅: 타임스탬프는 JS 로컬시각으로 명시) ----------
  const dbApi = {
    // 학생
    listStudents: () => DB.prepare('SELECT * FROM students ORDER BY name').all(),
    getStudentByCard: (u) => DB.prepare('SELECT * FROM students WHERE card_uid = ?').get(u),
    getStudentById: (id) => DB.prepare('SELECT * FROM students WHERE id = ?').get(id),
    addStudent({ card_uid, name, student_no = null, grade = null }) {
      const info = DB.prepare(
        'INSERT INTO students (card_uid, name, student_no, grade, points, created_at) VALUES (?,?,?,?,0,?)'
      ).run(card_uid, name, student_no, grade, nowLocal());
      return dbApi.getStudentById(info.lastInsertRowid);
    },
    updateStudent(id, { name, student_no, grade }) {
      DB.prepare('UPDATE students SET name=?, student_no=?, grade=? WHERE id=?')
        .run(name, student_no ?? null, grade ?? null, id);
      return dbApi.getStudentById(id);
    },
    deleteStudent: (id) => DB.prepare('DELETE FROM students WHERE id = ?').run(id),
    updateStudentPoints(id, points) {
      DB.prepare('UPDATE students SET points = ? WHERE id = ?').run(points, id);
      return dbApi.getStudentById(id);
    },
    adjustStudentPoints(id, delta) {
      DB.prepare('UPDATE students SET points = points + ? WHERE id = ?').run(delta, id);
      return dbApi.getStudentById(id);
    },

    // 출석
    recordAttendance(cardUid) {
      const student = dbApi.getStudentByCard(cardUid);
      const info = DB.prepare(
        'INSERT INTO attendance (card_uid, student_id, name, tapped_at) VALUES (?,?,?,?)'
      ).run(cardUid, student?.id ?? null, student?.name ?? null, nowLocal());
      return DB.prepare('SELECT * FROM attendance WHERE id = ?').get(info.lastInsertRowid);
    },
    setMood(attendanceId, mood) {
      DB.prepare('UPDATE attendance SET mood = ? WHERE id = ?').run(mood, attendanceId);
      return DB.prepare('SELECT * FROM attendance WHERE id = ?').get(attendanceId);
    },
    listAttendance(date = null) {
      if (date) {
        return DB.prepare('SELECT * FROM attendance WHERE date(tapped_at) = ? ORDER BY tapped_at DESC').all(date);
      }
      return DB.prepare('SELECT * FROM attendance ORDER BY tapped_at DESC LIMIT 500').all();
    },

    dashboardStats(date) {
      const totalStudents = DB.prepare('SELECT COUNT(*) AS c FROM students').get().c;
      const present = DB.prepare(
        `SELECT s.id, s.name, s.student_no, s.grade, MIN(a.tapped_at) AS first_tap
           FROM students s JOIN attendance a ON a.student_id = s.id
          WHERE date(a.tapped_at) = ? GROUP BY s.id ORDER BY first_tap`
      ).all(date);
      const moodRows = DB.prepare(
        `SELECT mood, COUNT(*) AS c FROM attendance
          WHERE mood IS NOT NULL AND date(tapped_at) = ? GROUP BY mood`
      ).all(date);
      const moods = {};
      for (const r of moodRows) moods[r.mood] = r.c;
      const presentIds = new Set(present.map((p) => p.id));
      const absent = DB.prepare('SELECT id, name, student_no, grade FROM students ORDER BY name')
        .all().filter((s) => !presentIds.has(s.id));
      const unknownTaps = DB.prepare(
        `SELECT COUNT(*) AS c FROM attendance WHERE student_id IS NULL AND date(tapped_at) = ?`
      ).get(date).c;
      const rows = DB.prepare(
        `SELECT date(tapped_at) AS d, COUNT(DISTINCT student_id) AS c FROM attendance
          WHERE student_id IS NOT NULL AND date(tapped_at) BETWEEN date(?, '-6 days') AND date(?)
          GROUP BY date(tapped_at)`
      ).all(date, date);
      const byDay = new Map(rows.map((r) => [r.d, r.c]));
      const daily = [];
      for (let i = 6; i >= 0; i--) {
        const d = DB.prepare('SELECT date(?, ?) AS d').get(date, `-${i} days`).d;
        daily.push({ date: d, count: byDay.get(d) ?? 0 });
      }
      return {
        date, totalStudents, presentCount: present.length, absentCount: absent.length,
        rate: totalStudents ? Math.round((present.length / totalStudents) * 100) : 0,
        unknownTaps, present, absent, daily, moods,
      };
    },

    moodStats(from, to) {
      const POS = ['great', 'good'], NEG = ['tired', 'sad', 'angry'];
      const SCORE = { great: 2, good: 1, soso: 0, tired: -1, sad: -1, angry: -2 };
      const rows = DB.prepare(
        `SELECT a.mood AS mood, date(a.tapped_at) AS d, a.student_id AS sid, s.name AS name
           FROM attendance a LEFT JOIN students s ON s.id = a.student_id
          WHERE a.mood IS NOT NULL AND date(a.tapped_at) BETWEEN ? AND ?`
      ).all(from, to);
      const byMood = {};
      let scoreSum = 0;
      for (const r of rows) { byMood[r.mood] = (byMood[r.mood] ?? 0) + 1; scoreSum += SCORE[r.mood] ?? 0; }
      const total = rows.length;
      const positive = POS.reduce((s, k) => s + (byMood[k] ?? 0), 0);
      const negative = NEG.reduce((s, k) => s + (byMood[k] ?? 0), 0);
      const neutral = total - positive - negative;
      const score = total ? scoreSum / total : 0;
      const dailyMap = new Map();
      for (const r of rows) {
        if (!dailyMap.has(r.d)) dailyMap.set(r.d, {});
        const m = dailyMap.get(r.d); m[r.mood] = (m[r.mood] ?? 0) + 1;
      }
      const daily = [];
      let cursor = from;
      for (let i = 0; i < 366; i++) {
        const bmd = dailyMap.get(cursor) ?? {};
        daily.push({ date: cursor, byMood: bmd, total: Object.values(bmd).reduce((a, b) => a + b, 0) });
        if (cursor === to) break;
        cursor = DB.prepare("SELECT date(?, '+1 day') AS d").get(cursor).d;
      }
      const concernRows = DB.prepare(
        `SELECT s.id AS id, s.name AS name, a.mood AS mood, COUNT(*) AS c
           FROM attendance a JOIN students s ON s.id = a.student_id
          WHERE a.mood IN ('tired','sad','angry') AND date(a.tapped_at) BETWEEN ? AND ?
          GROUP BY s.id, a.mood`
      ).all(from, to);
      const cMap = new Map();
      for (const r of concernRows) {
        if (!cMap.has(r.id)) cMap.set(r.id, { id: r.id, name: r.name, total: 0, byMood: {} });
        const e = cMap.get(r.id); e.byMood[r.mood] = r.c; e.total += r.c;
      }
      const concern = [...cMap.values()].sort((a, b) => b.total - a.total);
      const weather = (() => {
        if (!total) return { emoji: '🌫️', label: '기록 없음' };
        if (score >= 1.0) return { emoji: '☀️', label: '아주 맑음' };
        if (score >= 0.3) return { emoji: '🌤️', label: '맑음' };
        if (score >= -0.3) return { emoji: '⛅', label: '보통' };
        if (score >= -1.0) return { emoji: '🌧️', label: '흐림' };
        return { emoji: '⛈️', label: '폭풍우' };
      })();
      return {
        from, to, total, byMood, positive, negative, neutral,
        positiveRatio: total ? Math.round((positive / total) * 100) : 0,
        score: Math.round(score * 100) / 100, weather, daily, concern,
      };
    },

    // 도서
    listBooks: () => DB.prepare(
      `SELECT b.*, l.id AS active_loan_id, s.name AS borrower_name
         FROM books b
         LEFT JOIN loans l ON l.book_id = b.id AND l.returned_at IS NULL
         LEFT JOIN students s ON s.id = l.student_id
        ORDER BY b.title`
    ).all(),
    getBookByCard: (u) => DB.prepare('SELECT * FROM books WHERE card_uid = ?').get(u),
    addBook({ card_uid, title, author = null }) {
      const info = DB.prepare('INSERT INTO books (card_uid, title, author, created_at) VALUES (?,?,?,?)')
        .run(card_uid, title, author, nowLocal());
      return DB.prepare('SELECT * FROM books WHERE id = ?').get(info.lastInsertRowid);
    },
    deleteBook: (id) => DB.prepare('DELETE FROM books WHERE id = ?').run(id),
    activeLoanForBook: (bookId) => DB.prepare(
      'SELECT * FROM loans WHERE book_id = ? AND returned_at IS NULL ORDER BY id DESC LIMIT 1'
    ).get(bookId),
    createLoan(bookId, studentId) {
      const info = DB.prepare('INSERT INTO loans (book_id, student_id, borrowed_at) VALUES (?,?,?)')
        .run(bookId, studentId, nowLocal());
      return DB.prepare('SELECT * FROM loans WHERE id = ?').get(info.lastInsertRowid);
    },
    returnLoan(loanId) {
      DB.prepare('UPDATE loans SET returned_at = ? WHERE id = ?').run(nowLocal(), loanId);
      return DB.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
    },
    setLoanReview(loanId, rating, review) {
      DB.prepare('UPDATE loans SET rating = ?, review = ? WHERE id = ?')
        .run(rating ?? null, review ?? null, loanId);
      return DB.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
    },
    studentReadingRecord: (studentId) => DB.prepare(
      `SELECT l.id, l.borrowed_at, l.returned_at, l.rating, l.review, b.title, b.author
         FROM loans l JOIN books b ON b.id = l.book_id
        WHERE l.student_id = ? AND l.returned_at IS NOT NULL ORDER BY l.returned_at DESC`
    ).all(studentId),
    readingStats(goalBooks = 100) {
      const totalRead = DB.prepare('SELECT COUNT(*) AS c FROM loans WHERE returned_at IS NOT NULL').get().c;
      const currentlyOut = DB.prepare('SELECT COUNT(*) AS c FROM loans WHERE returned_at IS NULL').get().c;
      const totalBooks = DB.prepare('SELECT COUNT(*) AS c FROM books').get().c;
      const ranking = DB.prepare(
        `SELECT s.id, s.name, COUNT(l.id) AS read_count FROM students s
           JOIN loans l ON l.student_id = s.id AND l.returned_at IS NOT NULL
          GROUP BY s.id ORDER BY read_count DESC, s.name LIMIT 10`
      ).all();
      const recentReviews = DB.prepare(
        `SELECT l.rating, l.review, l.returned_at, b.title, s.name AS student_name
           FROM loans l JOIN books b ON b.id = l.book_id JOIN students s ON s.id = l.student_id
          WHERE l.review IS NOT NULL AND l.review <> '' ORDER BY l.returned_at DESC LIMIT 8`
      ).all();
      return {
        totalRead, currentlyOut, totalBooks, goalBooks,
        percent: goalBooks ? Math.min(100, Math.round((totalRead / goalBooks) * 100)) : 0,
        ranking, recentReviews,
      };
    },

    // 셔틀런
    addShuttleRecord(studentId, laps) {
      const info = DB.prepare('INSERT INTO shuttle_records (student_id, laps, created_at) VALUES (?,?,?)')
        .run(studentId, laps, nowLocal());
      return DB.prepare('SELECT * FROM shuttle_records WHERE id = ?').get(info.lastInsertRowid);
    },
    shuttleBest: (studentId) =>
      DB.prepare('SELECT MAX(laps) AS m FROM shuttle_records WHERE student_id = ?').get(studentId).m ?? 0,
    shuttleRecords(studentId = null) {
      if (studentId) {
        return DB.prepare(
          `SELECT r.*, s.name FROM shuttle_records r JOIN students s ON s.id = r.student_id
            WHERE r.student_id = ? ORDER BY r.created_at`
        ).all(studentId);
      }
      return DB.prepare(
        `SELECT r.*, s.name FROM shuttle_records r JOIN students s ON s.id = r.student_id
          ORDER BY r.created_at DESC LIMIT 200`
      ).all();
    },
    shuttleLeaderboard: () => DB.prepare(
      `SELECT s.id, s.name, MAX(r.laps) AS best, COUNT(r.id) AS attempts
         FROM students s JOIN shuttle_records r ON r.student_id = s.id
        GROUP BY s.id ORDER BY best DESC, s.name LIMIT 20`
    ).all(),

    // 서킷
    listStations: () => DB.prepare('SELECT * FROM stations ORDER BY name').all(),
    getStationByCard: (u) => DB.prepare('SELECT * FROM stations WHERE card_uid = ?').get(u),
    addStation({ card_uid, name }) {
      const info = DB.prepare('INSERT INTO stations (card_uid, name, created_at) VALUES (?,?,?)')
        .run(card_uid, name, nowLocal());
      return DB.prepare('SELECT * FROM stations WHERE id = ?').get(info.lastInsertRowid);
    },
    deleteStation: (id) => DB.prepare('DELETE FROM stations WHERE id = ?').run(id),
    addCircuitRecord(stationId, studentId, durationSec) {
      const info = DB.prepare(
        'INSERT INTO circuit_records (station_id, student_id, duration_sec, created_at) VALUES (?,?,?,?)'
      ).run(stationId, studentId, durationSec, nowLocal());
      return DB.prepare('SELECT * FROM circuit_records WHERE id = ?').get(info.lastInsertRowid);
    },
    circuitBest: (stationId, studentId) => DB.prepare(
      'SELECT MAX(duration_sec) AS m FROM circuit_records WHERE station_id = ? AND student_id = ?'
    ).get(stationId, studentId).m ?? 0,
    circuitRecords(studentId = null, stationId = null) {
      let sql = `SELECT c.*, s.name AS student_name, st.name AS station_name
                   FROM circuit_records c JOIN students s ON s.id = c.student_id
                   JOIN stations st ON st.id = c.station_id`;
      const where = [], args = [];
      if (studentId) { where.push('c.student_id = ?'); args.push(studentId); }
      if (stationId) { where.push('c.station_id = ?'); args.push(stationId); }
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY c.created_at DESC LIMIT 200';
      return DB.prepare(sql).all(...args);
    },
    circuitGrowth(studentId) {
      const rows = DB.prepare(
        `SELECT c.station_id, st.name AS station_name, c.duration_sec, c.created_at
           FROM circuit_records c JOIN stations st ON st.id = c.station_id
          WHERE c.student_id = ? ORDER BY c.created_at`
      ).all(studentId);
      const map = new Map();
      for (const r of rows) {
        if (!map.has(r.station_id))
          map.set(r.station_id, { stationId: r.station_id, name: r.station_name, points: [] });
        map.get(r.station_id).points.push({ at: r.created_at, sec: r.duration_sec });
      }
      return [...map.values()];
    },
  };

  // ============================================================
  // 3. 카드 파서 (src/parser.mjs 포팅: Buffer → Uint8Array)
  // ============================================================
  // CR-100: STX(0x02) + ASCII 카드번호 + CR LF + ETX(0x03)
  function createParser() {
    let buffer = new Uint8Array(0);
    const dec = new TextDecoder();
    const STX = 0x02, ETX = 0x03;
    function concat(a, b) {
      const out = new Uint8Array(a.length + b.length);
      out.set(a, 0); out.set(b, a.length); return out;
    }
    function indexOf(buf, byte, from = 0) {
      for (let i = from; i < buf.length; i++) if (buf[i] === byte) return i;
      return -1;
    }
    function normalize(s) { return s.trim().replace(/[^A-Za-z0-9]/g, ''); }
    function feed(chunk, onCard) {
      buffer = concat(buffer, chunk);
      let etx;
      while ((etx = indexOf(buffer, ETX)) !== -1) {
        const stx = indexOf(buffer, STX);
        const start = stx !== -1 && stx < etx ? stx + 1 : 0;
        const inner = dec.decode(buffer.subarray(start, etx));
        buffer = buffer.subarray(etx + 1);
        const uid = normalize(inner);
        if (uid) onCard(uid);
      }
    }
    return { feed };
  }

  // ============================================================
  // 4. 리더기 (Web Serial API — serialport 대체)
  // ============================================================
  const reader = {
    port: null,
    connected: false,
    keepReading: false,
    parser: createParser(),
    get statusInfo() {
      return { connected: this.connected, port: this.port ? 'USB (CR-100)' : '-', baudRate: baudRate() };
    },
    setStatus(connected, message = '') {
      this.connected = connected;
      broadcast({ type: 'status', ...this.statusInfo, message });
      console.log(`[리더기] ${message} (연결: ${connected})`);
    },
    // 저장된(권한 부여된) 포트를 자동으로 열기 — 사용자 클릭 없이
    async autoConnect() {
      if (!('serial' in navigator)) {
        this.setStatus(false, '이 브라우저는 Web Serial 을 지원하지 않습니다 (Chrome/크롬북에서 실행하세요)');
        return;
      }
      try {
        const ports = await navigator.serial.getPorts();
        if (ports.length) { await this.open(ports[0]); }
        else { this.setStatus(false, '리더기 연결 필요 — 설정 탭에서 [리더기 연결]을 누르세요'); }
      } catch (e) { this.setStatus(false, '리더기 자동 연결 실패: ' + e.message); }
    },
    // 사용자 제스처로 포트 권한 요청 후 연결
    async requestAndConnect() {
      const filters = [{ usbVendorId: CONFIG.serial.vendorId, usbProductId: CONFIG.serial.productId }];
      let p;
      try { p = await navigator.serial.requestPort({ filters }); }
      catch { p = null; } // 사용자가 취소
      if (!p) { try { p = await navigator.serial.requestPort(); } catch { return false; } }
      await this.open(p);
      return true;
    },
    async open(p) {
      try {
        if (this.port) await this.close();
        this.port = p;
        await p.open({ baudRate: baudRate() });
        try { await p.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch {}
        this.setStatus(true, '리더기 연결됨');
        this.keepReading = true;
        this.readLoop();
      } catch (e) {
        this.setStatus(false, '리더기 열기 실패: ' + e.message);
      }
    },
    async readLoop() {
      while (this.port && this.port.readable && this.keepReading) {
        const rd = this.port.readable.getReader();
        try {
          while (true) {
            const { value, done } = await rd.read();
            if (done) break;
            if (value && value.length) this.onData(value);
          }
        } catch (e) {
          this.setStatus(false, '읽기 오류: ' + e.message);
        } finally {
          rd.releaseLock();
        }
      }
    },
    onData(chunk) {
      // 진단용 raw 방송
      const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const text = [...chunk].map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '·')).join('');
      broadcast({ type: 'raw', hex, text, bytes: chunk.length, time: new Date().toISOString() });
      this.parser.feed(chunk, (uid) => onCard(uid));
    },
    async close() {
      this.keepReading = false;
      try { if (this.port) await this.port.close(); } catch {}
      this.port = null;
    },
    async reconfigure() {
      // baud 변경 시: 현재 포트를 같은 객체로 다시 열기
      const p = this.port;
      if (!p) return;
      await this.close();
      await this.open(p);
    },
    simulate(uid) { onCard(uid); },
  };

  // ============================================================
  // 5. 카드 태그 처리 로직 (src/server.mjs 포팅)
  // ============================================================
  const lastSeen = new Map();
  const debounceMs = (CONFIG.attendance.debounceSeconds ?? 5) * 1000;
  const goalBooks = CONFIG.reading.goalBooks ?? 100;
  let mode = 'attendance';
  let pendingBorrow = null;
  const shuttleLive = new Map();
  const circuitActive = new Map();
  let pendingCircuit = null;

  function clearPending() { if (pendingBorrow?.timer) clearTimeout(pendingBorrow.timer); pendingBorrow = null; }
  function clearPendingCircuit() { if (pendingCircuit?.timer) clearTimeout(pendingCircuit.timer); pendingCircuit = null; }
  function broadcastReading() { broadcast({ type: 'reading', stats: dbApi.readingStats(goalBooks) }); }

  function handleShuttleTap(uid) {
    const student = dbApi.getStudentByCard(uid);
    if (!student) return broadcast({ type: 'shuttle', step: 'unknown', uid });
    const cur = shuttleLive.get(student.id) ?? { studentId: student.id, name: student.name, laps: 0 };
    cur.laps += 1;
    shuttleLive.set(student.id, cur);
    const best = dbApi.shuttleBest(student.id);
    const isNewBest = cur.laps > best && best > 0;
    broadcast({ type: 'shuttle', step: 'lap', student, laps: cur.laps, best, isNewBest });
  }

  function handleCircuitTap(uid) {
    const student = dbApi.getStudentByCard(uid);
    const station = dbApi.getStationByCard(uid);
    if (student) {
      clearPendingCircuit();
      pendingCircuit = {
        student,
        timer: setTimeout(() => { pendingCircuit = null; broadcast({ type: 'circuit', step: 'timeout' }); }, 20000),
      };
      return broadcast({ type: 'circuit', step: 'student', student });
    }
    if (station) {
      const active = circuitActive.get(station.id);
      if (active) {
        const durationSec = Math.max(1, Math.round((Date.now() - active.startMs) / 1000));
        circuitActive.delete(station.id);
        clearPendingCircuit();
        const prevBest = dbApi.circuitBest(station.id, active.studentId);
        dbApi.addCircuitRecord(station.id, active.studentId, durationSec);
        const isNewBest = durationSec > prevBest;
        const s = dbApi.getStudentById(active.studentId);
        return broadcast({ type: 'circuit', step: 'finished', student: s, station, durationSec, prevBest, isNewBest });
      }
      if (!pendingCircuit) return broadcast({ type: 'circuit', step: 'need-student', station });
      const s = pendingCircuit.student;
      clearPendingCircuit();
      circuitActive.set(station.id, {
        studentId: s.id, studentName: s.name, stationId: station.id, stationName: station.name, startMs: Date.now(),
      });
      return broadcast({ type: 'circuit', step: 'started', student: s, station });
    }
    broadcast({ type: 'circuit', step: 'unknown', uid });
  }

  function handleLendingTap(uid) {
    const student = dbApi.getStudentByCard(uid);
    const book = dbApi.getBookByCard(uid);
    if (student) {
      clearPending();
      pendingBorrow = {
        student,
        timer: setTimeout(() => { pendingBorrow = null; broadcast({ type: 'lending', step: 'timeout' }); }, 15000),
      };
      return broadcast({ type: 'lending', step: 'student', student });
    }
    if (book) {
      const active = dbApi.activeLoanForBook(book.id);
      if (pendingBorrow) {
        if (active) return broadcast({ type: 'lending', step: 'error', message: `'${book.title}'은(는) 이미 대여 중입니다.`, book });
        const borrower = pendingBorrow.student;
        clearPending();
        const loan = dbApi.createLoan(book.id, borrower.id);
        broadcast({ type: 'lending', step: 'borrowed', student: borrower, book, loan });
        return broadcastReading();
      }
      if (active) {
        const loan = dbApi.returnLoan(active.id);
        const borrower = dbApi.getStudentById(active.student_id);
        broadcast({ type: 'lending', step: 'returned', book, loan, student: borrower });
        return broadcastReading();
      }
      return broadcast({ type: 'lending', step: 'need-student', book });
    }
    broadcast({ type: 'lending', step: 'unknown', uid });
  }

  function handleLookupTap(uid) {
    const student = dbApi.getStudentByCard(uid);
    if (student) return broadcast({ type: 'lookup', uid, kind: 'student', item: student });
    const book = dbApi.getBookByCard(uid);
    if (book) return broadcast({ type: 'lookup', uid, kind: 'book', item: book });
    const station = dbApi.getStationByCard(uid);
    if (station) return broadcast({ type: 'lookup', uid, kind: 'station', item: station });
    broadcast({ type: 'lookup', uid, kind: 'none' });
  }

  function onCard(uid) {
    if (mode === 'lending') return handleLendingTap(uid);
    if (mode === 'shuttle') return handleShuttleTap(uid);
    if (mode === 'circuit') return handleCircuitTap(uid);
    if (mode === 'lookup') return handleLookupTap(uid);

    const now = Date.now();
    const prev = lastSeen.get(uid) ?? 0;
    const duplicate = now - prev < debounceMs;
    lastSeen.set(uid, now);
    const student = dbApi.getStudentByCard(uid);
    if (!student) return broadcast({ type: 'tap', uid, known: false, duplicate, time: new Date().toISOString() });
    if (duplicate) return broadcast({ type: 'tap', uid, known: true, duplicate: true, student, time: new Date().toISOString() });
    const record = dbApi.recordAttendance(uid);
    broadcast({ type: 'tap', uid, known: true, duplicate: false, student, attendance: record, time: new Date().toISOString() });
  }

  // ============================================================
  // 6. fetch 라우터 (Express 라우트 대체)
  // ============================================================
  const J = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  async function route(method, path, query, body) {
    await readyPromise;

    // ---- 학생 ----
    if (path === '/api/students' && method === 'GET') return J(dbApi.listStudents());
    if (path === '/api/students' && method === 'POST') {
      const { card_uid, name, student_no, grade } = body;
      if (!card_uid || !name) return J({ error: '카드와 이름은 필수입니다.' }, 400);
      if (dbApi.getStudentByCard(card_uid)) return J({ error: '이미 등록된 카드입니다.' }, 409);
      return J(dbApi.addStudent({ card_uid, name, student_no, grade }));
    }
    let m;
    if ((m = path.match(/^\/api\/students\/(\d+)$/))) {
      const id = Number(m[1]);
      if (method === 'PUT') return J(dbApi.updateStudent(id, body));
      if (method === 'DELETE') { dbApi.deleteStudent(id); return J({ ok: true }); }
    }
    if ((m = path.match(/^\/api\/students\/(\d+)\/points$/)) && method === 'PUT') {
      const id = Number(m[1]);
      const { delta, points } = body;
      let updated;
      if (delta !== undefined) updated = dbApi.adjustStudentPoints(id, Number(delta));
      else if (points !== undefined) updated = dbApi.updateStudentPoints(id, Number(points));
      else return J({ error: 'delta 또는 points 값이 필요합니다.' }, 400);
      broadcast({ type: 'points', studentId: id, points: updated.points, student: updated });
      return J(updated);
    }

    // ---- 대시보드 / 감정 ----
    if (path === '/api/dashboard' && method === 'GET') {
      const date = query.date || new Date().toLocaleDateString('sv-SE');
      return J(dbApi.dashboardStats(date));
    }
    if (path === '/api/mood-stats' && method === 'GET') {
      const today = new Date().toLocaleDateString('sv-SE');
      const to = query.to || today;
      const weekAgo = new Date(Date.now() - 6 * 86400000).toLocaleDateString('sv-SE');
      const from = query.from || weekAgo;
      return J(dbApi.moodStats(from, to));
    }

    // ---- 출석 ----
    if (path === '/api/attendance' && method === 'GET') return J(dbApi.listAttendance(query.date || null));
    if (path === '/api/attendance/export' && method === 'GET') {
      const rows = dbApi.listAttendance(query.date || null);
      const header = '이름,카드UID,출석시각\n';
      const bodyCsv = rows.map((r) => `"${r.name ?? ''}","${r.card_uid}","${r.tapped_at}"`).join('\n');
      const csv = '﻿' + header + bodyCsv;
      const fname = `attendance_${query.date || 'all'}.csv`;
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fname}"`,
        },
      });
    }
    if ((m = path.match(/^\/api\/attendance\/(\d+)\/mood$/)) && method === 'POST') {
      const id = Number(m[1]);
      const updated = dbApi.setMood(id, body.mood);
      broadcast({ type: 'mood', attendanceId: id, mood: body.mood });
      return J(updated);
    }

    // ---- 모드 전환 ----
    if (path === '/api/mode' && method === 'POST') {
      const mm = body.mode || 'attendance';
      mode = ['attendance', 'lending', 'shuttle', 'circuit', 'lookup'].includes(mm) ? mm : 'attendance';
      clearPending(); clearPendingCircuit();
      broadcast({ type: 'mode', mode });
      broadcast({ type: 'lending', step: mode === 'lending' ? 'on' : 'off' });
      return J({ mode });
    }

    // ---- 셔틀런 ----
    if (path === '/api/shuttle/live' && method === 'GET') return J([...shuttleLive.values()]);
    if (path === '/api/shuttle/reset' && method === 'POST') {
      shuttleLive.clear(); broadcast({ type: 'shuttle', step: 'reset' }); return J({ ok: true });
    }
    if (path === '/api/shuttle/save' && method === 'POST') {
      const results = [];
      for (const v of shuttleLive.values()) {
        const prevBest = dbApi.shuttleBest(v.studentId);
        dbApi.addShuttleRecord(v.studentId, v.laps);
        results.push({ studentId: v.studentId, name: v.name, laps: v.laps, prevBest, isNewBest: v.laps > prevBest });
      }
      shuttleLive.clear();
      broadcast({ type: 'shuttle', step: 'saved' });
      return J(results);
    }
    if (path === '/api/shuttle/leaderboard' && method === 'GET') return J(dbApi.shuttleLeaderboard());
    if (path === '/api/shuttle/records' && method === 'GET')
      return J(dbApi.shuttleRecords(query.student_id ? Number(query.student_id) : null));

    // ---- 서킷 스테이션 ----
    if (path === '/api/stations' && method === 'GET') return J(dbApi.listStations());
    if (path === '/api/stations' && method === 'POST') {
      const { card_uid, name } = body;
      if (!card_uid || !name) return J({ error: '카드와 종목명은 필수입니다.' }, 400);
      if (dbApi.getStationByCard(card_uid) || dbApi.getStudentByCard(card_uid) || dbApi.getBookByCard(card_uid))
        return J({ error: '이미 사용 중인 카드입니다.' }, 409);
      return J(dbApi.addStation({ card_uid, name }));
    }
    if ((m = path.match(/^\/api\/stations\/(\d+)$/)) && method === 'DELETE') {
      dbApi.deleteStation(Number(m[1])); return J({ ok: true });
    }
    if (path === '/api/circuit/records' && method === 'GET')
      return J(dbApi.circuitRecords(
        query.student_id ? Number(query.student_id) : null,
        query.station_id ? Number(query.station_id) : null));
    if ((m = path.match(/^\/api\/circuit\/growth\/(\d+)$/)) && method === 'GET')
      return J(dbApi.circuitGrowth(Number(m[1])));

    // ---- 도서 ----
    if (path === '/api/books' && method === 'GET') return J(dbApi.listBooks());
    if (path === '/api/books' && method === 'POST') {
      const { card_uid, title, author } = body;
      if (!card_uid || !title) return J({ error: '카드와 책 제목은 필수입니다.' }, 400);
      if (dbApi.getBookByCard(card_uid)) return J({ error: '이미 등록된 도서 카드입니다.' }, 409);
      if (dbApi.getStudentByCard(card_uid)) return J({ error: '학생 카드로는 도서를 등록할 수 없습니다.' }, 409);
      return J(dbApi.addBook({ card_uid, title, author }));
    }
    if ((m = path.match(/^\/api\/books\/(\d+)$/)) && method === 'DELETE') {
      dbApi.deleteBook(Number(m[1])); return J({ ok: true });
    }
    if ((m = path.match(/^\/api\/books\/(\d+)\/return$/)) && method === 'POST') {
      const active = dbApi.activeLoanForBook(Number(m[1]));
      if (!active) return J({ error: '대여 중인 도서가 아닙니다.' }, 400);
      const loan = dbApi.returnLoan(active.id);
      broadcastReading();
      return J({ ok: true, loan });
    }
    if (path === '/api/reading/stats' && method === 'GET') return J(dbApi.readingStats(goalBooks));
    if ((m = path.match(/^\/api\/reading\/student\/(\d+)$/)) && method === 'GET')
      return J(dbApi.studentReadingRecord(Number(m[1])));
    if ((m = path.match(/^\/api\/loans\/(\d+)\/review$/)) && method === 'POST') {
      const updated = dbApi.setLoanReview(Number(m[1]), body.rating, body.review);
      broadcastReading();
      return J(updated);
    }

    // ---- 상태 / 진단 / 시리얼 ----
    if (path === '/api/status' && method === 'GET') return J(reader.statusInfo);
    if (path === '/api/ports' && method === 'GET') {
      const ports = ('serial' in navigator) ? await navigator.serial.getPorts() : [];
      return J(ports.map((p, i) => {
        const info = p.getInfo ? p.getInfo() : {};
        const vid = (info.usbVendorId ?? 0).toString(16).padStart(4, '0').toUpperCase();
        const pid = (info.usbProductId ?? 0).toString(16).padStart(4, '0').toUpperCase();
        const isReader = info.usbVendorId === CONFIG.serial.vendorId && info.usbProductId === CONFIG.serial.productId;
        return { path: `USB#${i + 1} ${vid}:${pid}`, manufacturer: '', friendlyName: isReader ? 'CR-100 (Silicon Labs CP210x)' : '',
                 vendorId: vid, productId: pid, isReader };
      }));
    }
    if (path === '/api/serial-config' && method === 'GET') {
      return J({ autoDetect: true, port: reader.statusInfo.port, baudRate: baudRate(), active: reader.statusInfo });
    }
    if (path === '/api/serial-config' && method === 'POST') {
      if (body.baudRate) localStorage.setItem(LS_BAUD, String(Number(body.baudRate)));
      // 포트가 아직 없으면 권한 요청, 있으면 새 baud 로 재연결
      if (!reader.port) await reader.requestAndConnect();
      else await reader.reconfigure();
      return J({ ok: true, serial: { baudRate: baudRate() } });
    }

    // ---- 테스트(가짜 카드) ----
    if (path === '/api/simulate' && method === 'POST') {
      const uid = body.uid || 'TEST' + Math.floor(Math.random() * 100000);
      reader.simulate(uid);
      return J({ ok: true, uid });
    }

    return J({ error: 'Not found', path }, 404);
  }

  // ============================================================
  // 7. window.fetch 패치 — /api/* 는 위 라우터로
  // ============================================================
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    let pathPart = url;
    // 절대/상대 모두 처리
    try {
      const u = new URL(url, location.href);
      if (u.pathname.startsWith('/api/')) {
        const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
        const query = Object.fromEntries(u.searchParams.entries());
        let bodyObj = {};
        const rawBody = init.body ?? (typeof input === 'object' ? input.body : undefined);
        if (rawBody && typeof rawBody === 'string') { try { bodyObj = JSON.parse(rawBody); } catch {} }
        return route(method, u.pathname, query, bodyObj);
      }
    } catch {}
    return realFetch(input, init);
  };

  // ============================================================
  // 8. 부팅 — sql.js 초기화, DB 복원, 리더기 자동 연결
  // ============================================================
  async function boot() {
    SQL = await initSqlJs({ locateFile: (f) => './vendor/' + f });
    const saved = await idbGet(IDB_KEY);
    rawDb = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
    initSchema();
    if (!saved) await persistNow();

    // 노출: 설정 탭의 "리더기 연결" 버튼 / 디버깅용
    window.NFC = {
      connectReader: () => reader.requestAndConnect(),
      reader, db: dbApi, exportDb: () => rawDb.export(),
    };

    resolveReady();

    // 리더기 자동 연결 + USB 분리 감지
    reader.autoConnect();
    if ('serial' in navigator) {
      navigator.serial.addEventListener('disconnect', (e) => {
        if (e.target === reader.port) reader.setStatus(false, '리더기 연결 끊김 (USB 분리됨)');
      });
      navigator.serial.addEventListener('connect', () => {
        if (!reader.connected) reader.autoConnect();
      });
    }
  }

  boot().catch((e) => {
    console.error('백엔드 초기화 실패', e);
    alert('앱 초기화에 실패했습니다: ' + e.message);
  });
})();
