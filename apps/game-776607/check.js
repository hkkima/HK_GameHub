// 서류 대장 정합성 검사 —  node check.js
//
// 많은 문서를 손으로 쓰면 오탈자 하나가 "조용한 오답"으로 남는다(정답이 반대로 박힌
// 서류는 플레이 중에 알아채기 어렵다). 유형별 규칙과 answer 가 어긋나는 항목,
// 빠진 필드, 중복 문서번호를 여기서 잡는다.

const DOCS = require('./game.docs.js');

const TYPES = ['standard', 'clean', 'multi', 'forgery', 'pressure', 'expedite', 'directive'];

// 유형별로 기대하는 [이탈 계획 수, 흠결 기재사항 수, 정답]
// null 은 "서류마다 다름"
const RULES = {
  standard: { plans: 1, fields: 0, answer: 'reject' },
  clean: { plans: 0, fields: 0, answer: 'accept' },
  multi: { plans: 2, fields: 0, answer: 'reject' },
  forgery: { plans: 0, fields: 1, answer: 'reject' },
  pressure: { plans: 0, fields: 0, answer: 'reject' },
  expedite: { plans: null, fields: 0, answer: null },
  directive: { plans: 1, fields: 0, answer: 'reject' },
};

const errors = [];
const seen = new Map();
const seenTitles = new Map();
const seenBodies = new Map();
const tally = {};

DOCS.forEach((d, i) => {
  const at = (msg) => errors.push(`[${i}] ${d.no || '문서번호 없음'} — ${msg}`);

  if (!d.no) at('no 누락');
  else if (seen.has(d.no)) at(`문서번호 중복 (앞서 ${seen.get(d.no)}번째에도 있음)`);
  else seen.set(d.no, i);

  if (seenTitles.has(d.title)) at(`제목 중복 (앞서 ${seenTitles.get(d.title)}번째에도 있음)`);
  else seenTitles.set(d.title, i);
  const bodyKey = [d.type,d.intent,...(d.plans||[]).map(p=>p.t)].join('|');
  if (seenBodies.has(bodyKey)) at(`문서 내용 중복 (앞서 ${seenBodies.get(bodyKey)}번째에도 있음)`);
  else seenBodies.set(bodyKey, i);

  for (const key of ['title', 'who', 'race', 'risk', 'intent', 'type', 'answer']) {
    if (!d[key]) at(`${key} 누락`);
  }
  if (!TYPES.includes(d.type)) { at(`알 수 없는 type: ${d.type}`); return; }
  tally[d.type] = (tally[d.type] || 0) + 1;

  if (!Array.isArray(d.plans) || d.plans.length !== 3) at(`plans 는 3개여야 함 (현재 ${d.plans ? d.plans.length : '없음'})`);
  if (!Array.isArray(d.fields) || d.fields.length < 3) at(`fields 는 3개 이상이어야 함 (현재 ${d.fields ? d.fields.length : '없음'})`);
  (d.fields || []).forEach((f, j) => { if (!f.k || !f.v) at(`fields[${j}] 에 k 또는 v 가 없음`); });
  (d.plans || []).forEach((p, j) => { if (!p.t) at(`plans[${j}] 에 t 가 없음`); });

  const badPlans = (d.plans || []).filter((p) => p.bad).length;
  const badFields = (d.fields || []).filter((f) => f.bad).length;
  const rule = RULES[d.type];

  if (rule.plans !== null && badPlans !== rule.plans) {
    at(`${d.type} 유형은 이탈 계획이 ${rule.plans}개여야 하는데 ${badPlans}개`);
  }
  if (badFields !== rule.fields) {
    at(`${d.type} 유형은 흠결 기재사항이 ${rule.fields}개여야 하는데 ${badFields}개`);
  }
  if (rule.answer !== null && d.answer !== rule.answer) {
    at(`${d.type} 유형의 정답은 ${rule.answer} 여야 하는데 ${d.answer}`);
  }
  // 급행은 정답이 서류마다 다르지만, 이탈 계획 유무와는 반드시 일치해야 한다.
  if (d.type === 'expedite') {
    const want = badPlans > 0 ? 'reject' : 'accept';
    if (d.answer !== want) at(`급행 서류: 이탈 계획 ${badPlans}개이므로 정답은 ${want} 여야 함 (현재 ${d.answer})`);
  }
  // 지시문은 directive 에만
  if (d.type === 'directive' && !d.order) at('directive 유형인데 order(지시문)가 없음');
  if (d.type !== 'directive' && d.order) at('directive 가 아닌데 order 가 붙어 있음');

  if (!['하', '중', '상'].includes(d.risk)) at(`risk 는 하/중/상 중 하나여야 함 (현재 ${d.risk})`);
});

// 9급이 처음 만나는 유형(standard·clean)만으로도 대기열이 돌아가야 한다.
const starters = DOCS.filter((d) => d.type === 'standard' || d.type === 'clean').length;
if (starters < 50) errors.push(`9급 해금 유형(standard·clean)이 ${starters}종뿐 — 초반 대기열 확장 목표 50종에 미달합니다.`);

const minimums = {standard:30, clean:20, multi:14, forgery:12, pressure:10, expedite:8, directive:8};
for (const [type, minimum] of Object.entries(minimums)) {
  if((tally[type] || 0) < minimum) errors.push(`${type} 유형이 ${tally[type] || 0}종뿐 — 최소 ${minimum}종이 필요합니다.`);
}

console.log(`서류 ${DOCS.length}종 검사`);
console.log('  유형 분포: ' + TYPES.map((t) => `${t} ${tally[t] || 0}`).join(' / '));

if (errors.length) {
  console.error(`\n오류 ${errors.length}건:`);
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('  정합성 검사 통과');
