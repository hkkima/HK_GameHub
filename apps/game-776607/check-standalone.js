const fs=require('fs');
const path=require('path');
const file=path.join(__dirname,'이계민원청 실행.html');
if(!fs.existsSync(file)) throw new Error('독립 실행 파일이 없습니다. node build-standalone.js 를 먼저 실행하세요.');
const html=fs.readFileSync(file,'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
if(scripts.length!==1) throw new Error(`내장 스크립트가 1개여야 하는데 ${scripts.length}개입니다.`);
new Function(scripts[0]);
if(/<script\s+src=/i.test(html)) throw new Error('외부 런타임 스크립트 참조가 남아 있습니다.');
const styles=[...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
if(/url\s*\(/i.test(styles)) throw new Error('외부 폰트·이미지 URL 참조가 남아 있습니다.');
for(const text of ['__mountIgyeGame(Component)','신 입 교 육 자 료','심사 힌트',"E('0571'",'game-shell','fitViewport','actionLocked','igye_save_v1','downloadSave','uploadSave']){
  if(!html.includes(text)) throw new Error(`필수 내용 누락: ${text}`);
}
console.log(`독립 실행 파일 검사 통과 (${Math.round(Buffer.byteLength(html)/1024)}KB)`);
