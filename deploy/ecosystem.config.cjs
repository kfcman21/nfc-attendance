// pm2 실행 설정 (kfcman.link/attend 서버) — 격리된 Node 22 인터프리터 사용
// 사용: cd /home/ubuntu/nfc-attendance && pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'nfc-attend',
      script: 'src/server.mjs',
      cwd: '/home/ubuntu/nfc-attendance',
      // 시스템 Node(20)와 분리: node:sqlite 지원하는 Node 22 단독 바이너리
      interpreter: '/opt/node22/bin/node',
      env: {
        NFC_PORT: '3100', // Nginx가 이 포트로 프록시 (nginx-attend.conf와 일치)
        NFC_DATA_DIR: '/var/lib/nfc-attendance', // 출석 DB 영구 저장 경로
        NFC_DISABLE_HTTPS: '1', // TLS는 Nginx가 처리
        NFC_DISABLE_SERIAL: '1', // 서버엔 리더기 없음 (HID/원격 입력만)
      },
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
