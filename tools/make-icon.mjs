// build/logo.svg → build/icon.ico (여러 해상도 포함)
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'build', 'logo.svg'));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(
  sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer())
);

// 256 PNG도 저장 (electron-builder가 다른 용도로 사용 가능)
writeFileSync(join(root, 'build', 'icon.png'), pngs[pngs.length - 1]);

const ico = await pngToIco(pngs);
writeFileSync(join(root, 'build', 'icon.ico'), ico);
console.log('생성 완료: build/icon.ico (' + ico.length + ' bytes), build/icon.png');
