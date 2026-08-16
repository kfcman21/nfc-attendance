// build/logo.svg → build/icon.ico (여러 해상도 포함) + PWA 아이콘 생성
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'build', 'logo.svg'));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(
  sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer())
);

// 256 및 512 PNG 저장
writeFileSync(join(root, 'build', 'icon.png'), pngs[pngs.length - 1]);

const ico = await pngToIco(pngs);
writeFileSync(join(root, 'build', 'icon.ico'), ico);
console.log('생성 완료: build/icon.ico (' + ico.length + ' bytes), build/icon.png');

// PWA 웹앱용 아이콘 갱신 (192px, 512px)
const pwaIconsDir = join(root, 'public', 'icons');
mkdirSync(pwaIconsDir, { recursive: true });

const pwa192 = await sharp(svg, { density: 384 }).resize(192, 192).png().toBuffer();
const pwa512 = await sharp(svg, { density: 384 }).resize(512, 512).png().toBuffer();

writeFileSync(join(pwaIconsDir, 'icon-192.png'), pwa192);
writeFileSync(join(pwaIconsDir, 'icon-512.png'), pwa512);
writeFileSync(join(pwaIconsDir, 'icon-maskable-512.png'), pwa512);
console.log('생성 완료: public/icons/ (icon-192.png, icon-512.png, icon-maskable-512.png)');
