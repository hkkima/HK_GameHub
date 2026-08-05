// 일회성 스크립트 — 추출된 template.html 을 편집하기 좋은 조각으로 분해한다.
//
// template.html 은 4,055줄이지만 그중 3,000줄 이상이 @font-face 블록(4회 중복)이고
// 실제로 손댈 곳은 세 군데뿐이다. 그 세 곳을 마커로 바꿔 shell.html 로 남기고,
// 내용은 각각 별도 파일로 뽑아 둔다. 이후 pack.js 가 마커에 다시 끼워 넣는다.
//
//   node split.js
//
// 이미 shell.html 이 있으면 아무 것도 하지 않는다(재실행 안전).

const fs = require('fs');
const path = require('path');

const D = __dirname;
const p = (n) => path.join(D, n);

if (fs.existsSync(p('shell.html'))) {
  console.log('shell.html 이 이미 있습니다. 분해를 건너뜁니다.');
  process.exit(0);
}

const lines = fs.readFileSync(p('template.html'), 'utf8').split('\n');

// 1-indexed 줄 번호로 잘라내는 헬퍼 (끝 포함)
const slice = (from, to) => lines.slice(from - 1, to).join('\n');
const at = (n) => lines[n - 1];

// 잘라낼 위치가 예상과 맞는지 먼저 확인한다. 어긋나면 조용히 망가지는 대신 멈춘다.
const expect = (n, needle) => {
  if (!at(n) || !at(n).includes(needle)) {
    throw new Error(`${n}번째 줄에 "${needle}" 가 있어야 하는데 실제로는: ${JSON.stringify(at(n))}`);
  }
};
expect(3374, '<style>');
expect(3375, 'html,body{margin:0;background:#8f8b88}');
expect(3382, '</style>');
expect(3383, '</helmet>');
expect(3385, 'width:1440px;height:900px');
expect(3761, '</div>');
expect(3762, '</x-dc>');
expect(3763, 'type="text/x-dc"');
expect(3764, 'class Component extends DCLogic');
expect(4051, '}');
expect(4052, '</script>');

fs.writeFileSync(p('game.style.css'), slice(3375, 3381) + '\n', 'utf8');
fs.writeFileSync(p('game.markup.html'), slice(3385, 3761) + '\n', 'utf8');
fs.writeFileSync(p('game.logic.js'), slice(3764, 4051) + '\n', 'utf8');

const shell = []
  .concat(lines.slice(0, 3374 - 1))          // 1 .. 3373
  .concat(['<style>', '/*@@STYLE@@*/', '</style>'])
  .concat(lines.slice(3383 - 1, 3385 - 1))   // 3383 .. 3384 (</helmet>, 빈 줄)
  .concat(['<!--@@MARKUP@@-->'])
  .concat(lines.slice(3762 - 1, 3764 - 1))   // 3762 .. 3763 (</x-dc>, <script ...>)
  .concat(['//@@LOGIC@@'])
  .concat(lines.slice(4052 - 1));            // 4052 .. 끝

fs.writeFileSync(p('shell.html'), shell.join('\n'), 'utf8');

console.log('분해 완료:');
for (const f of ['shell.html', 'game.style.css', 'game.markup.html', 'game.logic.js']) {
  console.log('  ' + f.padEnd(20) + fs.readFileSync(p(f), 'utf8').split('\n').length + '줄');
}
