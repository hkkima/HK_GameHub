// 원본 오프라인 번들 없이도 더블클릭으로 실행되는 단일 HTML을 만든다.
const fs=require('fs');
const path=require('path');
const dir=__dirname;
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');

const shell=read('shell.html');
const designStyles=[...shell.matchAll(/<style>([\s\S]*?)<\/style>/g)]
  .map(m=>m[1]).filter(css=>!css.includes('/*@@STYLE@@*/')).join('\n')
  .replace(/@font-face\s*{[\s\S]*?}/g,'');
const gameStyles=read('game.style.css');
const markup=read('game.markup.html');
const docs=read('game.docs.js');
const logic=read('game.logic.js').replace('//@@DOCS@@',docs);
const runtime=read('standalone.runtime.js');
const safeScript=text=>text.replace(/<\/script/gi,'<\\/script');

const html=`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>제7이계민원청</title>
<style>${designStyles}\n${gameStyles}
html,body{margin:0;width:100%;height:100%;background:#8f8b88;overflow:hidden}
#game-viewport{position:fixed;inset:0;overflow:hidden}
#game-shell{position:absolute;top:0;left:50%;width:1440px;height:900px;transform-origin:top center}
#app{width:1440px;height:900px;box-shadow:0 0 40px rgba(0,0,0,.18)}
#boot-error{position:fixed;inset:24px;z-index:9999;overflow:auto;white-space:pre-wrap;margin:0;padding:20px;border:2px solid #8b1e1e;background:#fff;color:#8b1e1e;font:13px/1.5 monospace}
</style></head><body>
<div id="boot-error" hidden></div><div id="game-viewport"><div id="game-shell"><div id="app"></div></div></div>
<template id="game-template">${markup}</template>
<script>${safeScript(runtime)}\n${safeScript(logic)}\n__mountIgyeGame(Component);</script>
</body></html>`;

const output=path.join(dir,'이계민원청 실행.html');
fs.writeFileSync(output,html,'utf8');
console.log('독립 실행 파일 생성 → '+path.basename(output));
console.log('크기 '+Math.round(Buffer.byteLength(html)/1024)+'KB');
