// API 키 등 비밀값을 로컬 디스크에 암호화(AES-256-GCM)해 저장하기 위한 헬퍼.
// - 암호화 키(.secret.key)는 데이터 폴더에 자동 생성되며 git에 올라가지 않는다(data/는 .gitignore).
// - 암호문 형식: enc:v1:<iv(base64)>:<authTag(base64)>:<ciphertext(base64)>
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = 'enc:v1:';

// 데이터 폴더의 암호화 키를 읽고, 없으면 새로 만들어 저장한다. (32바이트 = AES-256)
export function loadOrCreateSecretKey(dataDir) {
  const keyPath = join(dataDir, '.secret.key');
  if (existsSync(keyPath)) {
    const hex = readFileSync(keyPath, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
  }
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  return key;
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(key, plain) {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ct].map((b) => b.toString('base64')).join(':');
}

// 암호문이면 복호화, 평문이면 그대로 반환(예전 설정 호환). 실패 시 빈 문자열.
export function decryptSecret(key, value) {
  if (!value) return '';
  if (!isEncrypted(value)) return String(value);
  try {
    const [iv, tag, ct] = value.slice(PREFIX.length).split(':').map((s) => Buffer.from(s, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
