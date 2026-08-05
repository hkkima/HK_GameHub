// 헤드리스 스모크 테스트 — node smoke.js
//
// 브라우저 없이 게임 로직만 떼어내 돌려 본다. React 는 element 를 만드는 흉내만
// 내는 스텁으로 대체하고(속성 접근이 실패하지 않을 정도), DCLogic 은 setState 를
// 동기 병합으로 구현한다. 목적은 문법이 아니라 "실행 중 터지는 런타임 오류"를
// 잡는 것 — 특히 renderVals()/renderDoc()/renderHr()/renderOverlays() 전부를
// 여러 상태 조합에서 실제로 호출해 본다.

const fs = require('fs');

const docs = fs.readFileSync('./game.docs.js', 'utf8');
const logicSrc = fs.readFileSync('./game.logic.js', 'utf8').replace('//@@DOCS@@', () => docs);

class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; }
  setState(patch) {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = Object.assign({}, this.state, next);
  }
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children };
  }
};

const Component = new Function('DCLogic', 'React', logicSrc + '\n;return Component;')(DCLogic, React);

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log('  OK   ' + label); }
  catch (e) { failures++; console.error('  FAIL ' + label + ' — ' + e.message); console.error(e.stack.split('\n').slice(1,4).join('\n')); }
};

console.log('컴포넌트 생성');
const c = new Component({});
check('renderVals() 최초 호출', () => c.renderVals());
check('최초 튜토리얼 5단계 표시', () => {
  if (!c.state.tutorialOpen || c.tutorialPages().length !== 5) throw new Error('튜토리얼 초기 상태 오류');
  c.renderOverlays(c.state);
});

console.log('\n단계별 힌트');
check('유형별 1·2단계 힌트 생성', () => {
  for (const type of ['standard','clean','multi','forgery','pressure','expedite','directive']) {
    const doc = c.docs.find(d=>d.type===type);
    if (!c.hintFor(doc,1) || !c.hintFor(doc,2)) throw new Error(type+' 힌트 누락');
  }
});
check('힌트 단계는 2에서 정지', () => {
  c.state.hintLevel=0; c.state.hintUses=0;
  c.showHint(); c.showHint(); c.showHint();
  if(c.state.hintLevel!==2 || c.state.hintUses!==2) throw new Error('힌트 단계 제한 오류');
});

console.log('\n전체 ' + c.docs.length + '종 서류를 한 바퀴 돌며 판정');
const seenTypes = new Set();
for (const targetDoc of c.docs) {
  c.state.rankIdx = 6;
  c.state.pool = [targetDoc].concat(c.docs.filter(d=>d !== targetDoc));
  c.state.sel = null;
  const doc = c.state.pool[0];
  seenTypes.add(doc.type);

  // 정답에 맞는 지목을 골라 준다
  if (doc.type === 'forgery') {
    const pi = doc.plans.findIndex(p => p.bad);
    if (pi >= 0) c.select('plan', pi);
  } else if (doc.type === 'pressure') {
    c.select('intent', 0);
  } else if (doc.type === 'multi' || doc.type === 'standard' || doc.type === 'directive') {
    const pi = doc.plans.findIndex(p => p.bad);
    if (pi >= 0) c.select('plan', pi);
  }

  const kind = doc.answer === 'accept' ? 'accept' : 'reject';
  check('process(' + kind + ') on ' + doc.type + ' [' + doc.no + ']', () => c.process(kind, true));
}
console.log('  유형 커버리지: ' + [...seenTypes].sort().join(', '));
console.log('\nRapid-click judgment lock');
check('two immediate clicks process only one document', () => {
  const doc = c.docs.find(d => d.type === 'clean') || c.docs[0];
  c.state.report = null;
  c.state.promo = null;
  c.state.processing = false;
  c.state.pool = [doc].concat(c.docs.filter(d => d !== doc));
  const before = {
    processed:c.state.processed,
    judged:c.state.judged,
    accepts:c.state.accepts,
    queue:c.state.queue,
    floaters:c.state.floaters.length
  };
  const kind = doc.answer === 'accept' ? 'accept' : 'reject';
  c.process(kind);
  c.process(kind);
  if (c.state.processed !== before.processed + 1) throw new Error('one click sequence processed multiple documents');
  if (c.state.judged !== before.judged + 1) throw new Error('judgment counter increased more than once');
  if (c.state.accepts !== before.accepts + 1) throw new Error('accept counter increased more than once');
  if (c.state.queue !== Math.max(0,before.queue - 1)) throw new Error('queue advanced more than once');
  if (c.state.floaters.length !== before.floaters + 1) throw new Error('judgment effect was created more than once');
  c.state.processing = false;
});

console.log('\nCombo persistence');
check('combo does not decay as time passes', () => {
  c.state.report = null;
  c.state.promo = null;
  c.state.processing = false;
  c.state.combo = 7;
  c.tick();
  c.tick();
  if(c.state.combo !== 7) throw new Error('combo decayed during timer ticks');
});

console.log('\nPer-player browser save');
check('fresh browser starts a new game and saved progress restores', () => {
  const memory = new Map();
  global.localStorage = {
    getItem:key=>memory.has(key)?memory.get(key):null,
    setItem:(key,value)=>memory.set(key,String(value)),
    removeItem:key=>memory.delete(key)
  };
  const fresh = new Component({});
  if(fresh.state.processed !== 0 || !fresh.state.tutorialOpen) throw new Error('fresh player did not start from the beginning');
  fresh.state.processed = 37;
  fresh.state.stamps = 4321;
  fresh.state.tutorialOpen = false;
  if(!fresh.saveProgressNow()) throw new Error('save failed');
  const restored = new Component({});
  if(restored.state.processed !== 37 || restored.state.stamps !== 4321 || restored.state.tutorialOpen) throw new Error('saved progress was not restored');
  if(!restored.state.pool.length) throw new Error('document queue was not restored');
  delete global.localStorage;
});

const allTypes = ['standard','clean','multi','forgery','pressure','expedite','directive'];
const missing = allTypes.filter(t => !seenTypes.has(t));
if (missing.length) { failures++; console.error('  FAIL 스모크 루프에서 다루지 못한 유형: ' + missing.join(', ')); }

console.log('\n최근 문서 반복 방지');
check('최근 20건을 새 대기열 뒤로 배치', () => {
  c.state.rankIdx = 6;
  c.state.recentDocNos = c.docs.slice(0,20).map(d=>d.no);
  const pool = c.buildPool(6);
  if (c.state.recentDocNos.includes(pool[0].no)) throw new Error('최근 문서가 새 대기열 첫 장에 배치됨');
});

console.log('\n지시형(directive) 승인 — 오심 집계 + 결재력 대박 경로');
check('directive 서류 강제 후 승인', () => {
  const directiveDoc = c.docs.find(d => d.type === 'directive');
  c.state.pool = [directiveDoc, ...c.docs.filter(d => d !== directiveDoc)];
  const before = c.state.stamps, misses0 = c.state.misses;
  c.process('accept', true);
  if (c.state.stamps <= before) throw new Error('결재력이 오르지 않음');
  if (c.state.misses !== misses0 + 1) throw new Error('오심으로 집계되지 않음');
});

console.log('\n급행(expedite) 타이머 만료');
check('expire() 호출', () => {
  const expDoc = c.docs.find(d => d.type === 'expedite');
  c.state.pool = [expDoc, ...c.docs.filter(d => d !== expDoc)];
  c.state.timeLeft = 0;
  const q0 = c.state.queue;
  c.expire();
  if (c.state.queue !== q0 + 3) throw new Error('대기열 증가가 반영되지 않음');
});

console.log('\n렌더 함수 개별 호출 (여러 화면)');
['main','upgrade','story','hr','settings'].forEach(scr => {
  check('screen=' + scr + ' renderVals()', () => { c.state.screen = scr; c.renderVals(); });
});

console.log('\n교대 종료 → 정산 모달 → 퇴근 도장');
check('stage goal met → endShift()', () => {
  c.state.report = null; c.state.promo = null;
  c.endShift();
  if (!c.state.report) throw new Error('교대 종료 시 report 가 세팅되지 않음');
});
check('renderOverlays() — report 상태', () => c.renderOverlays(c.state));
check('closeReport()', () => {
  const shiftNoBefore = c.state.shiftNo;
  c.closeReport();
  if (c.state.shiftNo !== shiftNoBefore + 1) throw new Error('shiftNo 증가 안 됨');
  if (c.state.report !== null) throw new Error('report 가 닫히지 않음');
});

console.log('\n승진 임계치 직접 도달 → 임용장');
check('exp 강제 상승 후 closeReport 재실행', () => {
  c.state.rankIdx = 0;
  c.state.exp = 0;
  c.state.report = { grade:'S', score:99, acc:1, judged:10, bonus:100, gems:5, exp: 5000, word:'테스트', sh: c.blankShift(), shiftNo: c.state.shiftNo };
  c.closeReport();
  if (!c.state.promo) throw new Error('promo 가 세팅되지 않음 (exp=5000 이면 최소 8급 이상이어야 함)');
  if (c.state.rankIdx === 0) throw new Error('rankIdx 가 올라가지 않음');
});
check('renderOverlays() — promo 상태', () => c.renderOverlays(c.state));
check('closePromo()', () => { c.closePromo(); if (c.state.promo !== null) throw new Error('promo 가 닫히지 않음'); });

console.log('\n리셋');
check('doReset()', () => { c.renderVals().doReset(); });

console.log('\n' + (failures ? failures + '건 실패' : '전체 통과'));
process.exit(failures ? 1 : 0);
