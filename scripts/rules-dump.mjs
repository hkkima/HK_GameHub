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
import { readFileSync } from 'node:fs';

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const project = process.env.PROJECT_ID;

if (!keyPath || !project) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS 와 PROJECT_ID 환경변수가 필요합니다.');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
const b64url = (v) => Buffer.from(v).toString('base64url');

async function getAccessToken(scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope,
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`토큰 발급 실패 ${res.status}\n${body}`);
    process.exit(1);
  }
  return JSON.parse(body).access_token;
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

for (const f of ruleset.source?.files || []) {
  console.log(`===== ${f.name} =====`);
  console.log(f.content);
  console.log(`===== end ${f.name} =====`);
}
