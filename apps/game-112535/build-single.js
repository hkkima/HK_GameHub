/* ONLY UP : ZHAO — 단일 HTML 빌드
 *
 *   node build-single.js
 *
 * index.html 의 <script src> 태그들을 실제 코드로 치환해서
 * 상위 폴더에 only-up-zhao.html 하나만 만든다. (더블클릭 실행, 오프라인 동작)
 * 모듈 파일을 수정한 뒤 다시 실행하면 된다.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, '..', 'only-up-zhao.html');

// 로드 순서 = index.html 의 태그 순서와 반드시 같아야 한다
const SOURCES = [
  'three.min.js',
  'js/util.js',
  'js/character.js',
  'js/level.js',
  'js/game.js'
];

function read(rel) {
  const p = path.join(ROOT, rel);
  const txt = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  // 인라인 <script> 안에서 </script> 나 <!-- 가 나오면 파싱이 깨진다
  if (/<\/script/i.test(txt)) throw new Error(rel + ' 안에 </script 가 있어 인라인할 수 없다');
  if (txt.indexOf('<!--') >= 0) throw new Error(rel + ' 안에 <!-- 가 있어 인라인할 수 없다');
  return txt;
}

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/^﻿/, '');

// 연속된 <script src="..."></script> 묶음(앞의 주석 포함)을 통째로 찾는다
const TAGS = /(?:[ \t]*<!--[^\n]*-->[\r\n]+)?(?:[ \t]*<script src="[^"]+"><\/script>[\r\n]*)+/;
const m = html.match(TAGS);
if (!m) throw new Error('index.html 에서 <script src> 묶음을 찾지 못했다');

// 파일마다 별도의 <script> 블록으로 넣는다(three.js UMD 와 게임 코드를 분리)
const inlined = SOURCES.map((rel) => {
  const code = read(rel);
  return '<script>\n/* ==================== ' + rel + ' ==================== */\n' + code + '\n</script>';
}).join('\n');

// 반드시 치환 "함수" 를 써야 한다. 치환 문자열로 넘기면 압축된 three.js 안의
// $& · $` · $' 같은 시퀀스가 특수 패턴으로 해석돼 코드가 깨진다.
html = html.replace(TAGS, () => inlined + '\n');

// 생성물임을 head 안에 명시
html = html.replace('<head>', () => '<head>\n<!-- 자동 생성 파일: only-up-zhao/build-single.js 로 만들어졌다.'
  + ' 수정은 only-up-zhao/js/*.js 에서 하고 다시 빌드할 것. -->');

fs.writeFileSync(OUT, html, 'utf8');

console.log('출력:', path.resolve(OUT));
SOURCES.forEach((rel) => {
  const n = fs.statSync(path.join(ROOT, rel)).size;
  console.log('  + ' + rel.padEnd(20) + (n / 1024).toFixed(1).padStart(8) + ' KB');
});
console.log('  = 단일 HTML' + ' '.repeat(11) + (fs.statSync(OUT).size / 1024).toFixed(1).padStart(8) + ' KB');
const inlineCount = (html.match(/<script>/g) || []).length;
const extCount = (html.match(/<script src=/g) || []).length;
console.log('인라인 <script> 블록:', inlineCount + '개, 남은 외부 참조:', extCount + '개');
if (inlineCount !== SOURCES.length || extCount !== 0) {
  console.error('!! 빌드 이상: 인라인 블록 수가 맞지 않거나 외부 참조가 남았다');
  process.exit(1);
}
