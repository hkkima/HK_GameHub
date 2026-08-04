#!/usr/bin/env node
//
// 로컬 개발 서버
//
//   허브  http://localhost:5173
//   게임  http://localhost:5174
//
// 포트를 나누는 것은 취향이 아니라 설계다. 브라우저는 포트가 다르면 다른 오리진으로
// 보기 때문에, 로컬에서도 배포 환경과 똑같은 격리 조건에서 테스트하게 된다.
//
//   node scripts/build.mjs && node scripts/dev.mjs

import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HUB = path.join(ROOT, 'dist', 'hub');
const GAMES = path.join(ROOT, 'dist', 'games');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
};

function serve(rootDir, label, port) {
  if (!existsSync(rootDir)) {
    console.error(`${rootDir} 가 없습니다. 먼저 npm run build 를 실행하세요.`);
    process.exit(1);
  }

  http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(rootDir, url);

    // 디렉터리 탈출 차단
    if (!file.startsWith(rootDir)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');

    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`404 ${url}`);
      return;
    }

    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  }).listen(port, () => {
    console.log(`  ${label.padEnd(4)} http://localhost:${port}`);
  });
}

console.log('\nHK GameHub 개발 서버\n');
serve(HUB, '허브', 5173);
serve(GAMES, '게임', 5174);
console.log('\n  Ctrl+C 로 종료\n');
