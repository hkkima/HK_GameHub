#!/usr/bin/env node
//
// 현재 배포되어 있는 Firestore 보안 규칙을 그대로 출력한다.
//
// 이 프로젝트의 Firestore 는 다른 앱과 공유하므로, 허브 규칙을 넣기 전에
// 지금 무엇이 배포되어 있는지 먼저 봐야 한다. 보고 나서 병합한 뒤에 배포한다.
//
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json PROJECT_ID=... node scripts/rules-dump.mjs
//
// 액세스 토큰은 서비스 계정 키로 직접 만든다(JWT bearer). google-github-actions/auth 의
// token_format: access_token 은 IAM 의 generateAccessToken 을 거치는데, 그러려면
// 서비스 계정이 자기 자신을 가장할 수 있어야 해서 Token Creator 역할이 추가로 필요하다.
// 표준 JWT 흐름은 키만 있으면 되므로 권한을 더 주지 않아도 된다.
//
// 규칙 본문은 비밀이 아니므로 로그로 출력해도 된다. 접근 통제는 규칙이 하지,
// 규칙을 숨겨서 하는 것이 아니다.

import crypto from 'node:crypto';
import { getAccessToken } from './gcp-auth.mjs';

const project = process.env.PROJECT_ID;
if (!project) {
  console.error('PROJECT_ID 환경변수가 필요합니다.');
  process.exit(1);
}

const token = await getAccessToken('https://www.googleapis.com/auth/cloud-platform');

const api = async (url) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  if (!res.ok) {
    console.error(`${res.status} ${url}\n${body}`);
    if (res.status === 403) {
      console.error('\n서비스 계정에 "Firebase Rules 관리자"(roles/firebaserules.admin) 역할이 있는지 확인하세요.');
    }
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

// 규칙 본문은 base64 로 내보낸다.
//
// GitHub Actions 는 여러 줄 시크릿을 줄 단위로도 마스킹한다. 서비스 계정 JSON 의
// 첫 줄과 끝 줄이 각각 "{" 와 "}" 이므로, 로그에 찍히는 모든 중괄호가 *** 로 가려진다.
// 규칙은 중괄호가 구조 그 자체라 그대로 출력하면 쓸모가 없어진다.
// base64 에는 중괄호가 없으므로 원문이 온전히 남는다.
for (const f of ruleset.source?.files || []) {
  const b64 = Buffer.from(f.content, 'utf8').toString('base64');
  console.log(`===== BASE64 ${f.name} =====`);
  // 한 줄이 너무 길면 로그에서 잘리므로 100자씩 끊는다
  for (let i = 0; i < b64.length; i += 100) console.log(b64.slice(i, i + 100));
  console.log(`===== END ${f.name} =====`);
  console.log('');
  console.log(`# ${f.name}: ${f.content.length} bytes, sha256=${crypto.createHash('sha256').update(f.content).digest('hex').slice(0, 16)}`);
}
