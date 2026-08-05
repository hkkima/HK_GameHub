// 이계민원청 클리커 — 오프라인 번들 재포장 스크립트
//
// 원본 번들(6.4MB)은 397줄짜리 언패커 셸이고, 게임 전체는 `__bundler/template`
// 스크립트 태그 안에 JSON 문자열 하나로 들어 있다. 폰트 woff2 blob과 dc-runtime은
// `__bundler/manifest` 쪽에 그대로 남겨 두고, template 한 줄만 교체한다.
//
//   node pack.js            조각들 → template.html → v2 번들 출력
//   node pack.js --extract  원본 번들에서 template.html 추출 (최초 1회)
//
// 언패커가 하는 일은 JSON.parse(templateEl.textContent) 뿐이므로 이 교체로 충분하다.
//
// template.html 은 split.js 가 만든 조각들로부터 매번 다시 조립된다. 직접 고칠 파일은
// game.style.css / game.markup.html / game.logic.js 세 개이고, shell.html(폰트 3천여 줄)은
// 건드리지 않는다.

const fs = require('fs');
const path = require('path');

const SRC_DIR = __dirname;
const ROOT = path.dirname(SRC_DIR);
const ORIGINAL = path.join(ROOT, '이계민원청 클리커 (오프라인).html');
const OUTPUT = path.join(ROOT, '이계민원청 클리커 v2 (오프라인).html');
const TEMPLATE = path.join(SRC_DIR, 'template.html');
const SHELL = path.join(SRC_DIR, 'shell.html');

const TEMPLATE_TAG = '<script type="__bundler/template">';

/** 셸을 줄 배열로 읽고 template 값이 놓인 줄 번호를 찾는다. */
function readShell() {
  const lines = fs.readFileSync(ORIGINAL, 'utf8').split(/\r?\n/);
  const tagIdx = lines.findIndex((l) => l.trim() === TEMPLATE_TAG);
  if (tagIdx === -1) throw new Error('원본에서 ' + TEMPLATE_TAG + ' 를 찾지 못했습니다.');
  return { lines, valueIdx: tagIdx + 1 };
}

function extract() {
  const { lines, valueIdx } = readShell();
  const html = JSON.parse(lines[valueIdx].trim());
  fs.writeFileSync(TEMPLATE, html, 'utf8');
  console.log('추출 완료 → ' + path.relative(ROOT, TEMPLATE));
  console.log('  ' + html.length.toLocaleString('ko-KR') + '자 / ' +
    html.split('\n').length.toLocaleString('ko-KR') + '줄');
}

/** shell.html 의 세 마커에 편집 대상 조각들을 끼워 template.html 을 조립한다. */
function assemble() {
  if (!fs.existsSync(SHELL)) throw new Error('shell.html 이 없습니다. 먼저 split.js 를 실행하세요.');
  const read = (n) => fs.readFileSync(path.join(SRC_DIR, n), 'utf8').replace(/\n$/, '');
  let html = fs.readFileSync(SHELL, 'utf8');

  // game.logic.js 는 //@@DOCS@@ 마커에 game.docs.js(서류 대장)를 먼저 인라인한다.
  // module.exports 가드가 있어 브라우저(new Function 안, module 미정의)에서도 안전하다.
  let logic = read('game.logic.js');
  if (!logic.includes('//@@DOCS@@')) throw new Error('game.logic.js 에 마커 //@@DOCS@@ 가 없습니다.');
  logic = logic.replace('//@@DOCS@@', () => read('game.docs.js'));

  const parts = {
    '/*@@STYLE@@*/': () => read('game.style.css'),
    '<!--@@MARKUP@@-->': () => read('game.markup.html'),
    '//@@LOGIC@@': () => logic,
  };
  for (const [marker, get] of Object.entries(parts)) {
    if (!html.includes(marker)) throw new Error('shell.html 에 마커 ' + marker + ' 가 없습니다.');
    // 조각 내용에 $ 패턴이 있어도 안전하도록 replace 콜백을 쓴다.
    html = html.replace(marker, get);
  }
  fs.writeFileSync(TEMPLATE, html, 'utf8');
  return html;
}

function pack() {
  const { lines, valueIdx } = readShell();
  const html = assemble();

  // `</` 를 이스케이프해야 문자열 안의 `</script>` 가 감싸는 태그를 조기 종료하지 않는다.
  // 원본 번들이 쓰는 것과 같은 형태(</)로 맞춘다.
  lines[valueIdx] = JSON.stringify(html).replace(/<\//g, '<\\u002F');

  fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf8');

  const before = fs.statSync(ORIGINAL).size;
  const after = fs.statSync(OUTPUT).size;
  const mb = (n) => (n / 1024 / 1024).toFixed(2) + 'MB';
  console.log('포장 완료 → ' + path.basename(OUTPUT));
  console.log('  원본 ' + mb(before) + ' → 산출물 ' + mb(after) +
    ' (' + (after >= before ? '+' : '') + ((after - before) / 1024).toFixed(0) + 'KB)');

  // 폰트/런타임 blob이 유실되면 파일이 급감한다. 안전장치로 확인만 해 둔다.
  if (after < before * 0.9) {
    console.warn('  경고: 산출물이 원본보다 10% 이상 작습니다. manifest 유실을 확인하세요.');
  }
  // 라운드트립 검증 — 방금 쓴 파일에서 template을 되읽어 원본과 일치하는지 본다.
  const back = JSON.parse(fs.readFileSync(OUTPUT, 'utf8').split(/\r?\n/)[valueIdx].trim());
  if (back !== html) throw new Error('라운드트립 실패: 되읽은 template이 입력과 다릅니다.');
  console.log('  라운드트립 검증 통과');
}

if (process.argv.includes('--extract')) extract();
else pack();
