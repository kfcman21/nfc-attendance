// CR-100 시리얼 리더기 연결 모듈.
// 카드를 읽으면 'card' 이벤트로 UID를 내보낸다.
// 연결 상태는 'status' 이벤트로 알린다.
import { EventEmitter } from 'node:events';
import { SerialPort } from 'serialport';
import { createParser } from './parser.mjs';

export class Reader extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.port = null;
    this.connected = false;
    this.parser = createParser(config.parser);
    this.idleTimer = null;
    this.activePort = config.serial.port; // 실제 연결된(또는 시도 중인) 포트
  }

  get statusInfo() {
    return {
      connected: this.connected,
      port: this.activePort,
      baudRate: this.config.serial.baudRate,
    };
  }

  start() {
    this._open();
  }

  _setStatus(connected, message = '') {
    this.connected = connected;
    this.emit('status', { ...this.statusInfo, message });
  }

  // 리더기 포트를 자동 탐지. 우선순위:
  //  1) VID:PID 일치 (기본 CR-100 = 10C4:EA60)
  //  2) 제조사/이름에 silicon labs 또는 cp210 포함 (드라이버가 VID:PID를 안 채우는 PC 대응)
  //  3) 블루투스가 아닌 USB 시리얼 포트 중 첫 번째
  //  4) 그래도 없으면 config의 고정 포트
  // → autoDetect=false면 항상 고정 포트 사용.
  async _resolvePort() {
    const s = this.config.serial;
    if (s.autoDetect === false) return s.port;
    const vid = (s.vendorId || '10C4').toLowerCase();
    const pid = (s.productId || 'EA60').toLowerCase();
    try {
      const ports = await SerialPort.list();
      const txt = (p) => `${p.manufacturer || ''} ${p.friendlyName || ''} ${p.pnpId || ''}`.toLowerCase();
      const isBluetooth = (p) => /bluetooth|블루투스/.test(txt(p));

      const byVidPid = ports.find(
        (p) => (p.vendorId || '').toLowerCase() === vid && (p.productId || '').toLowerCase() === pid
      );
      if (byVidPid) return byVidPid.path;

      const byName = ports.find((p) => /silicon labs|cp210|cr-?100/.test(txt(p)));
      if (byName) return byName.path;

      const usbish = ports.find((p) => p.vendorId && !isBluetooth(p));
      if (usbish) return usbish.path;

      // 리더기를 못 찾음: 블루투스 포트에 잘못 연결해 "가짜 연결됨"을 만들지 않는다.
      // (config.port가 이 PC에서 블루투스일 수 있으므로) 연결을 보류하고 안내.
      const fallback = ports.find((p) => p.path === s.port && !isBluetooth(p));
      return fallback ? fallback.path : null;
    } catch {}
    return s.port; // list 실패 시에만 고정 포트 시도
  }

  // 현재 설정으로 다시 연결 (포트/통신속도 변경 시)
  async reconfigure(serialConfig = {}) {
    this.config.serial = { ...this.config.serial, ...serialConfig };
    this._reconnecting = false;
    try {
      if (this.port && this.port.isOpen) {
        await new Promise((r) => this.port.close(() => r()));
      }
    } catch {}
    this._open();
  }

  async _open() {
    const { baudRate } = this.config.serial;
    this.activePort = await this._resolvePort();

    // 자동탐지로 리더기를 못 찾은 경우: 잘못된 포트에 연결하지 않고 안내 후 재시도
    if (!this.activePort) {
      this._setStatus(false, '리더기를 찾지 못했습니다 — 설정·진단 탭에서 포트를 직접 선택하세요');
      this._scheduleReconnect();
      return;
    }

    this.port = new SerialPort({ path: this.activePort, baudRate, autoOpen: false });

    this.port.open((err) => {
      if (err) {
        this._setStatus(false, `리더기를 찾는 중... (${err.message})`);
        this._scheduleReconnect();
        return;
      }
      // DTR/RTS를 켜줘야 데이터를 보내는 리더기 대응 (연결됐는데 조용한 경우)
      this.port.set({ dtr: true, rts: true }, () => {});
      this._setStatus(true, `리더기 연결됨 (${this.activePort})`);
    });

    this.port.on('data', (chunk) => this._onData(chunk));

    this.port.on('close', () => {
      this._setStatus(false, '리더기 연결 끊김');
      this._scheduleReconnect();
    });

    this.port.on('error', (err) => {
      this._setStatus(false, `오류: ${err.message}`);
    });
  }

  _onData(chunk) {
    this.emit('raw', chunk); // 진단용: 들어온 원시 바이트
    this.parser.feed(chunk, (uid) => this.emit('card', uid));

    // delimiter 없이 보내는 리더기 대비: 80ms 입력 멈추면 남은 버퍼를 카드로 처리
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.parser.flushPending((uid) => this.emit('card', uid));
    }, 80);
  }

  _scheduleReconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    setTimeout(() => {
      this._reconnecting = false;
      this._open();
    }, 3000);
  }

  // 하드웨어 없이 테스트할 때 카드 태그를 흉내낸다.
  simulate(uid) {
    this.emit('card', uid);
  }
}
