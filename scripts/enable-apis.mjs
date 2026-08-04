#!/usr/bin/env node
//
// 함수 배포에 필요한데 firebase-tools 가 알아서 켜 주지 않는 API 를 활성화한다.
//
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json PROJECT_ID=... node scripts/enable-apis.mjs
//
// firebase-tools 는 run·eventarc·pubsub·storage 등은 배포 중에 스스로 켜지만,
// 요금제를 확인할 때 쓰는 cloudbilling 은 켜지 않고 호출만 해서 프로젝트에 그 API 가
// 꺼져 있으면 배포가 그 지점에서 멈춘다.
//
// 활성화는 멱등적이다. 이미 켜져 있으면 그대로 넘어간다.
// API 를 켜는 것과 요금이 부과되는 것은 별개다 — cloudbilling 은 요금 정보를
// 조회하는 API 일 뿐이고, 켠다고 과금 방식이 달라지지 않는다.

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

for (const service of SERVICES) {
  const res = await fetch(
    `https://serviceusage.googleapis.com/v1/projects/${project}/services/${service}:enable`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    },
  );

  const body = await res.text();
  if (res.ok) {
    console.log(`✔ ${service}`);
  } else {
    console.error(`✗ ${service} — ${res.status}\n${body}`);
    process.exit(1);
  }
}
