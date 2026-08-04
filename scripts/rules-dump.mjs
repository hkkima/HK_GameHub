#!/usr/bin/env node
//
// 현재 배포되어 있는 Firestore 보안 규칙을 그대로 출력한다.
//
// 이 프로젝트의 Firestore 는 다른 앱과 공유하므로, 허브 규칙을 넣기 전에
// 지금 무엇이 배포되어 있는지 먼저 봐야 한다. 보고 나서 병합한 뒤에 배포한다.
//
//   ACCESS_TOKEN=... PROJECT_ID=... node scripts/rules-dump.mjs
//
// 규칙 본문은 비밀이 아니므로 로그로 출력해도 된다. 접근 통제는 규칙이 하지,
// 규칙을 숨겨서 하는 것이 아니다.

const token = process.env.ACCESS_TOKEN;
const project = process.env.PROJECT_ID;

if (!token || !project) {
  console.error('ACCESS_TOKEN 과 PROJECT_ID 환경변수가 필요합니다.');
  process.exit(1);
}

const api = async (url) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  if (!res.ok) {
    console.error(`${res.status} ${url}\n${body}`);
    process.exit(1);
  }
  return JSON.parse(body);
};

const base = 'https://firebaserules.googleapis.com/v1';

// cloud.firestore 릴리스가 현재 어떤 ruleset 을 가리키는지 확인한다
const release = await api(`${base}/projects/${project}/releases/cloud.firestore`);
const ruleset = await api(`${base}/${release.rulesetName}`);

console.log(`# project     : ${project}`);
console.log(`# ruleset     : ${release.rulesetName}`);
console.log(`# createTime  : ${ruleset.createTime}`);
console.log('');

for (const f of ruleset.source?.files || []) {
  console.log(`===== ${f.name} =====`);
  console.log(f.content);
  console.log(`===== end ${f.name} =====`);
}
