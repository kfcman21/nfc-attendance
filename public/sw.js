// NFC 학생 출석 — PWA 서비스워커 (크롬북 설치형 웹앱용)
// 정적 셸(HTML/CSS/JS/아이콘)만 캐시한다. 실시간 데이터(/api/*)와 SSE는 절대 캐시하지 않고 네트워크로 통과시킨다.
const CACHE = 'nfc-attendance-shell-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // 출석 기록 등 POST는 항상 네트워크
  const url = new URL(req.url);

  // 동일 출처가 아니면(구글 폰트 등) 서비스워커가 관여하지 않음 — 브라우저 기본 처리
  if (url.origin !== self.location.origin) return;

  // 실시간 API와 SSE는 캐시 금지 — 항상 서버로 (오프라인이면 자연스럽게 실패)
  if (url.pathname.startsWith('/api/')) return;

  // 페이지 이동(문서 요청): 네트워크 우선, 실패 시 캐시된 셸로 폴백(오프라인에도 화면은 뜸)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // 그 외 정적 자산: 캐시 우선, 동시에 백그라운드 갱신(stale-while-revalidate)
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
