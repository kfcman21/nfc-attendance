// 리더기가 시리얼로 보낸 바이트를 "카드 UID 문자열"로 바꾸는 파서.
// config.json 의 parser 설정에 따라 동작.
//
// CR-100(이 PC의 리더기)은 다음 프레임으로 보낸다:
//   STX(0x02) + "68006948C5"(ASCII 카드번호) + CR LF(0x0D 0x0A) + ETX(0x03)
// → mode: "stx-etx" 가 이 형식을 처리한다.

export function createParser(parserConfig) {
  const {
    mode = 'stx-etx',
    trim = true,
    stripNonAlphanumeric = true,
    delimiter = '\r\n',
    startByte = 0x02,
    endByte = 0x03,
  } = parserConfig;

  let buffer = Buffer.alloc(0);

  // 누적된 바이트에서 완성된 카드 UID들을 뽑아내 onCard(uid)를 호출.
  function feed(chunk, onCard) {
    buffer = Buffer.concat([buffer, chunk]);

    if (mode === 'stx-etx') {
      feedFramed(onCard);
    } else if (mode === 'raw-hex') {
      const hex = buffer.toString('hex').toUpperCase();
      buffer = Buffer.alloc(0);
      if (hex.length > 0) onCard(hex);
    } else {
      feedLine(onCard);
    }
  }

  // STX ... ETX 사이의 텍스트를 카드 UID로 추출
  function feedFramed(onCard) {
    let etx;
    while ((etx = buffer.indexOf(endByte)) !== -1) {
      let stx = buffer.indexOf(startByte);
      // ETX 앞에 STX가 있으면 그 사이를, 없으면 처음부터 ETX까지를 내용으로
      const start = stx !== -1 && stx < etx ? stx + 1 : 0;
      const inner = buffer.subarray(start, etx).toString('utf8');
      buffer = buffer.subarray(etx + 1); // ETX 이후만 남김
      const uid = normalize(inner, { trim: true, stripNonAlphanumeric: true });
      if (uid) onCard(uid);
    }
  }

  // delimiter(줄바꿈 등)로 구분된 텍스트
  function feedLine(onCard) {
    const delim = Buffer.from(delimiter, 'binary');
    let idx;
    while ((idx = buffer.indexOf(delim)) !== -1) {
      const line = buffer.subarray(0, idx).toString('utf8');
      buffer = buffer.subarray(idx + delim.length);
      const uid = normalize(line, { trim, stripNonAlphanumeric });
      if (uid) onCard(uid);
    }
  }

  // delimiter/ETX 없이 한 번에 보내는 리더기를 위한 보조 처리.
  // stx-etx 모드는 프레임으로 끝을 알 수 있어 사용하지 않는다.
  function flushPending(onCard) {
    if (mode === 'stx-etx' || mode === 'raw-hex') return;
    if (buffer.length === 0) return;
    const uid = normalize(buffer.toString('utf8'), { trim, stripNonAlphanumeric });
    buffer = Buffer.alloc(0);
    if (uid) onCard(uid);
  }

  return { feed, flushPending };
}

function normalize(s, { trim, stripNonAlphanumeric }) {
  let out = s;
  if (trim) out = out.trim();
  if (stripNonAlphanumeric) out = out.replace(/[^A-Za-z0-9]/g, '');
  return out;
}
