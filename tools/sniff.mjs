// CR-100 리더기 진단 도구
// 사용법:
//   1) 포트 목록 보기:        node tools/sniff.mjs
//   2) 특정 포트 엿보기:      node tools/sniff.mjs COM9
//   3) baud rate 지정:        node tools/sniff.mjs COM9 115200
//
// 리더기에 카드를 한 번 태그하면, 무엇이 들어오는지 16진수(HEX)와 글자(ASCII)로 보여줍니다.
// 그 출력을 그대로 복사해서 알려주시면 규격을 맞춰드립니다.

import { SerialPort } from 'serialport';

const COMMON_BAUDS = [9600, 19200, 38400, 57600, 115200];

function asHex(buf) {
  return [...buf].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function asAscii(buf) {
  // 보이는 글자는 그대로, 안 보이는 제어문자는 점(.)으로
  return [...buf]
    .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
    .join('');
}

async function listPorts() {
  const ports = await SerialPort.list();
  console.log('\n=== 연결된 시리얼 포트 목록 ===\n');
  if (ports.length === 0) {
    console.log('  (포트를 찾지 못했습니다. 리더기 USB 연결을 확인하세요.)');
    return ports;
  }
  for (const p of ports) {
    console.log(`  ${p.path}`);
    if (p.friendlyName) console.log(`      이름   : ${p.friendlyName}`);
    if (p.manufacturer) console.log(`      제조사 : ${p.manufacturer}`);
    if (p.vendorId) console.log(`      VID:PID: ${p.vendorId}:${p.productId}`);
    console.log('');
  }
  console.log('CR-100 리더기로 보이는 포트를 골라 아래처럼 실행하세요:');
  console.log('   node tools/sniff.mjs <포트이름>     (예: node tools/sniff.mjs COM9)\n');
  return ports;
}

function watchPort(path, baud) {
  console.log(`\n=== ${path} 를 ${baud} bps 로 엿봅니다 ===`);
  console.log('지금 리더기에 카드를 한 번 태그해 보세요. (종료: Ctrl+C)\n');

  const port = new SerialPort({ path, baudRate: baud }, (err) => {
    if (err) {
      console.error(`[열기 실패] ${err.message}`);
      console.error('→ 포트 이름이 맞는지, 다른 프로그램이 포트를 쓰고 있지 않은지 확인하세요.');
      process.exit(1);
    }
  });

  port.on('open', () => console.log('포트 열림. 카드를 기다리는 중...\n'));

  port.on('data', (buf) => {
    const t = new Date().toLocaleTimeString('ko-KR');
    console.log(`[${t}] ${buf.length} bytes`);
    console.log(`   HEX  : ${asHex(buf)}`);
    console.log(`   TEXT : ${asAscii(buf)}\n`);
  });

  port.on('error', (err) => console.error(`[오류] ${err.message}`));
}

const [, , portArg, baudArg] = process.argv;

if (!portArg) {
  await listPorts();
} else {
  const baud = baudArg ? Number(baudArg) : 9600;
  if (!baudArg) {
    console.log(`\n(baud rate를 지정하지 않아 기본 ${baud} 으로 시도합니다.`);
    console.log(` 만약 글자가 깨져 보이면 다른 속도로 다시 시도하세요:`);
    console.log(` ${COMMON_BAUDS.map((b) => `node tools/sniff.mjs ${portArg} ${b}`).join('\n ')})`);
  }
  watchPort(portArg, baud);
}
