#!/usr/bin/env node
//
// 함수 배포에 필요한데 firebase-tools 가 알아서 켜 주지 않는 API 를 확인/활성화한다.
//
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json PROJECT_ID=... node scripts/enable-apis.mjs
//
// firebase-tools 는 run·eventarc·pubsub·storage 등은 배포 중에 스스로 켜지만,
// 요금제를 확인할 때 쓰는 cloudbilling 은 켜지 않고 호출만 한다. 프로젝트에 그 API 가
// 꺼져 있으면 배포가 그 지점에서 멈춘다.
//
// 서비스 계정이 켤 수 있는 API 는 한정적이다. Firebase 관리자 역할은 Firebase 가
// 관리하는 API 만 켤 수 있고 cloudbilling 은 그 범위 밖이라, 대개 사람이 콘솔에서
// 한 번 켜 줘야 한다. 그래서 이 스크립트는 먼저 상태를 확인하고 이미 켜져 있으면
// 그냥 넘어간다. 켜야 하는데 못 켜면 콘솔 링크를 안내하고 멈춘다.

import { getAccessToken } from './gcp-auth.mjs';

const project = process.env.PROJECT_ID;
if (!project) {
  console.error('PROJECT_ID 환경변수가 필요합니다.');
  process.exit(1);
}

const SERVICES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['cloudbilling.googleapis.com'];

const token = await getAccessToken();
const auth = { Authorization: `Bearer ${token}` };
const base = `https://serviceusage.googleapis.com/v1/projects/${project}/services`;

let failed = false;

for (const service of SERVICES) {
  // 1. 이미 켜져 있는지 본다
  let state = null;
  try {
    const res = await fetch(`${base}/${service}`, { headers: auth });
    if (res.ok) state = (await res.json()).state;
  } catch { /* 조회 실패는 아래에서 활성화 시도로 넘긴다 */ }

  if (state === 'ENABLED') {
    console.log(`✔ ${service} — 이미 활성화됨`);
    continue;
  }

  if (state === null) {
    // 조회 권한조차 없으면 판단을 미루고 firebase-tools 가 실제 오류를 내게 둔다
    console.log(`· ${service} — 상태를 확인할 수 없어 건너뜁니다`);
    continue;
  }

  // 2. 꺼져 있으면 켜 본다
  const res = await fetch(`${base}/${service}:enable`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: '{}',
  });

  if (res.ok) {
    console.log(`✔ ${service} — 활성화했습니다`);
    continue;
  }

  failed = true;
  console.error(`✗ ${service} — 활성화하지 못했습니다 (${res.status})`);
  console.error('');
  console.error('  서비스 계정 권한으로는 이 API 를 켤 수 없습니다.');
  console.error('  콘솔에서 한 번 켜 주세요 (요금 부과 방식과는 무관한 조회용 API 입니다):');
  console.error(`  https://console.cloud.google.com/apis/library/${service}?project=${project}`);
  console.error('');
}

process.exit(failed ? 1 : 0);
