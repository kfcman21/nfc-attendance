// Electron 메인 프로세스
// - 리더기/DB를 다루는 서버(src/server.mjs)를 별도 Node 프로세스로 실행
// - 준비되면 데스크톱 창을 열어 웹 화면을 표시
import { app, BrowserWindow, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
const PORT = config.server?.port ?? 3000;
const URL = `http://127.0.0.1:${PORT}`;

let serverProc = null;
let win = null;

function startServer() {
  // Electron 내장 Node로 서버 실행 (ELECTRON_RUN_AS_NODE).
  // serialport는 N-API 프리빌트라 재빌드 불필요, node:sqlite는 내장.
  // → 대상 PC에 별도 Node.js 설치가 필요 없는 완전 독립형.
  // 배포 시 DB는 쓰기 가능한 사용자 데이터 폴더에 저장.
  serverProc = spawn(process.execPath, [join(__dirname, 'src', 'server.mjs')], {
    cwd: __dirname,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NFC_DATA_DIR: app.getPath('userData'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on('exit', (code) => console.log(`[server] 종료 (code ${code})`));
  serverProc.on('error', (err) => {
    dialog.showErrorBox('시작 실패', `내부 서버를 시작하지 못했습니다.\n\n${err.message}`);
    app.quit();
  });
}

// 서버가 응답할 때까지 기다림 (최대 ~20초)
function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      http
        .get(`${URL}/api/status`, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) reject(new Error('서버 시작 시간 초과'));
          else setTimeout(tryOnce, 300);
        });
    };
    tryOnce();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: '학생 출석 - CR-100',
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true },
  });
  win.removeMenu(); // 기본 메뉴바 숨김
  win.loadURL(URL);
  win.on('closed', () => (win = null));
}

// 로딩 중 임시 화면
function showSplash() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: '학생 출석 - CR-100',
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true },
  });
  win.removeMenu();
  win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        `<html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#ffffff;color:#111111;font-family:Malgun Gothic,sans-serif;font-size:18px;font-weight:600">프로그램을 시작하는 중...</body></html>`
      )
  );
  win.on('closed', () => (win = null));
}

  app.whenReady().then(async () => {
  startServer();
  showSplash();
  try {
    await waitForServer();
    if (win) {
      win.loadURL(URL);
      win.webContents.openDevTools(); // 개발자 도구 창 강제 열기 (디버깅용)
    }
  } catch (e) {
    dialog.showErrorBox('시작 실패', `서버를 시작하지 못했습니다.\n\n${e.message}`);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function stopServer() {
  if (serverProc && !serverProc.killed) {
    // shell:true 로 띄웠으므로 자식까지 정리 (Windows)
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', serverProc.pid, '/f', '/t']);
      else serverProc.kill();
    } catch {}
  }
}

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('before-quit', stopServer);
process.on('exit', stopServer);
