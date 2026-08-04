// 서비스 계정 키로 액세스 토큰을 만든다 (JWT bearer 흐름).
//
// google-github-actions/auth 의 access_token 모드는 IAM generateAccessToken 을
// 거치는데, 그러려면 서비스 계정이 자기 자신을 가장할 수 있어야 해서 Token Creator
// 역할이 추가로 필요하다. 키로 직접 서명하는 이 방식은 추가 권한을 요구하지 않는다.

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const b64url = (v) => Buffer.from(v).toString('base64url');

export function loadKey(path = process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  if (!path) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 가 설정되지 않았습니다.');
  return JSON.parse(readFileSync(path, 'utf8'));
}

export async function getAccessToken(scope = 'https://www.googleapis.com/auth/cloud-platform', key = loadKey()) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email,
    scope,
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  }));

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64url(signer.sign(key.private_key))}`;

  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`토큰 발급 실패 ${res.status}\n${body}`);
  return JSON.parse(body).access_token;
}
