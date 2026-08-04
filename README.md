# HK GameHub

기획 수강생들이 만든 웹 게임을 전시하고, 브라우저에서 바로 플레이하고, 좋아요를 누르는 허브입니다.

| | 주소 |
|---|---|
| 허브 | https://hk-gamehub.pages.dev |
| 게임 | https://hk-games.pages.dev |

<br>

## 구조

```
                     ┌─────────────────────────────┐
   수강생 PR  ──────▶ │  GitHub Actions             │
                     │  apps/ 를 훑어 빌드·조립      │
                     └──────────┬──────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
   hk-gamehub.pages.dev                  hk-games.pages.dev
   갤러리 · 로그인 · 좋아요        ◀iframe▶   수강생 게임 정적 파일
              │
              ▼
   Firebase (hk-chess-betting)
   익명 인증 + 이름·PIN 확인, Firestore (좋아요)
```

### 왜 도메인을 두 개로 나눴나

수강생이 만든 게임은 **신뢰할 수 없는 코드**입니다. 허브와 같은 오리진에서 실행하면
게임 안의 JS 가 IndexedDB 에 있는 Firebase 인증 토큰을 읽어 다른 수강생을 사칭할 수 있습니다.

`*.pages.dev` 는 Public Suffix List 에 등록되어 있어서, Cloudflare Pages 프로젝트를
두 개로 나누면 서로 완전히 분리된 사이트가 됩니다. 그래서 게임을 샌드박스 iframe 에
넣고 `allow-same-origin` 을 줘도 허브의 로그인 정보는 안전합니다.

로컬 개발(`npm run dev`)에서도 허브 5173 / 게임 5174 로 포트를 나눠 같은 조건을 만듭니다.

### 왜 Firestore 인가

인증을 기존 Firebase 프로젝트로 하기 때문입니다. 같은 프로젝트의 Firestore 를 쓰면
보안 규칙에서 `request.auth.uid` 를 바로 쓸 수 있어 **서버가 아예 필요 없습니다.**
다른 DB 를 쓰면 Firebase ID 토큰을 검증해 교환하는 백엔드를 따로 띄워야 합니다.

이 프로젝트는 다른 앱과 공유하므로, 허브가 쓰는 컬렉션에는 `gamehub_` 접두사를
붙였습니다(`gamehub_games`, `gamehub_users`). 기존 `users` 컬렉션과 이름이 겹치면
참가자 문서를 덮어쓰게 되기 때문입니다. `firestore.rules` 는 기존 규칙 전체를 포함한
통합본입니다 — 자세한 내용은 [docs/SETUP.md](docs/SETUP.md) 를 보세요.

### 수강생 인증

기존 학급 앱과 동일합니다. Google 로그인은 운영자 전용이라 허브에서는 쓰지 않습니다.

```
이름·PIN 입력 → users/{이름슬러그}.pinHash 대조 → signInAnonymously()
```

Firebase 계정은 익명이고 학급 신원은 Firestore 의 `users` 문서라, 좋아요도
익명 uid 가 아니라 **참가자 ID** 로 기록됩니다. 그래서 기기를 바꿔도 좋아요가 따라옵니다.

이름 슬러그와 PIN 해시는 기존 앱 구현과 바이트 단위로 같아야 합니다
([`hub/auth.js`](hub/auth.js) 참고). 다르면 같은 이름·PIN 으로 로그인이 안 됩니다.

<br>

## 비용

수업 규모에서는 전부 무료 한도 안입니다.

| 항목 | 무료 한도 | 초과 시 |
|---|---|---|
| Cloudflare Pages | 대역폭 무제한, 빌드 500회/월, 파일당 25MB | Workers Paid $5/월 |
| Firestore (Spark) | 1GiB, 읽기 5만/일, 쓰기 2만/일 | Blaze 종량제 |
| GitHub Actions | 퍼블릭 레포 무제한 | — |

갤러리 메타데이터는 Firestore 가 아니라 빌드 때 만든 정적 `games.json` 을 읽습니다.
Firestore 는 좋아요에만 쓰므로, 갤러리 한 번 열 때 **읽기 2회**(좋아요 수 전체 + 내 좋아요 목록)만 발생합니다.

<br>

## 처음 세팅

[docs/SETUP.md](docs/SETUP.md) 를 따라가세요. Firebase config 를 `hub/config.js` 에 넣고
Cloudflare 토큰을 GitHub Secrets 에 등록하는 것이 전부입니다.

<br>

## 게임 올리기

[docs/SUBMISSION.md](docs/SUBMISSION.md) — 수강생에게 이 문서를 전달하시면 됩니다.

요약하면 `apps/<내-게임-이름>/` 폴더를 만들고 `manifest.json` 과 `index.html` 을 넣어
PR 을 올리면 됩니다. React 등 빌드가 필요한 앱은 `package.json` 만 있으면 CI 가 알아서 빌드합니다.

<br>

## 로컬에서 확인

```bash
npm run build     # apps/ 전체를 빌드해 dist/ 에 조립
npm run dev       # 허브 :5173, 게임 :5174 로 서빙
```

특정 앱만 빠르게 확인하려면

```bash
node scripts/build.mjs <slug>
```

<br>

## 레포 구성

```
apps/                 수강생 게임 (폴더 하나 = 게임 하나)
  _template/          제출용 템플릿 (밑줄로 시작하면 빌드 대상에서 제외)
  demo-reaction/      파이프라인 확인용 샘플 게임
hub/                  갤러리 앱 (빌드 도구 없는 순수 ES 모듈)
  config.js           Firebase config 와 게임 오리진  ← 여기를 채워야 함
scripts/
  build.mjs           빌드·조립
  dev.mjs             로컬 개발 서버
firestore.rules       Firestore 보안 규칙
```
