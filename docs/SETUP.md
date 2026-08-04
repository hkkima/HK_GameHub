# 최초 세팅 가이드

운영자가 한 번만 하면 되는 작업입니다. 전부 무료이고 신용카드도 필요 없습니다.

<br>

## 1. Firebase (hk_hub)

### 1-1. 웹 앱 config 가져오기

1. [Firebase 콘솔](https://console.firebase.google.com) → **hk_hub** 프로젝트
2. 왼쪽 위 **톱니바퀴 → 프로젝트 설정**
3. **일반** 탭 맨 아래 **내 앱** 섹션
   - 웹 앱(`</>`)이 이미 있으면 → **SDK 설정 및 구성** → **구성** 선택
   - 없으면 `</>` 로 새로 추가 (닉네임 `HK GameHub`, Firebase Hosting 설정은 **체크 해제**)
4. 나온 값을 [`hub/config.js`](../hub/config.js) 의 `firebaseConfig` 에 그대로 붙여넣습니다.

```js
export const firebaseConfig = {
  apiKey: 'AIza...',
  authDomain: 'hk-hub-xxxx.firebaseapp.com',
  projectId: 'hk-hub-xxxx',
  storageBucket: 'hk-hub-xxxx.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};
```

> 이 값들은 **공개되어도 되는 식별자**입니다. 비밀키가 아니며 레포에 커밋해도 됩니다.
> 실제 접근 통제는 `firestore.rules` 가 담당합니다.

### 1-2. 승인된 도메인 추가

**Authentication → 설정 → 승인된 도메인** 에 다음을 추가합니다.

```
hk-gamehub.pages.dev
```

이걸 빠뜨리면 로그인 팝업이 `auth/unauthorized-domain` 으로 실패합니다.

### 1-3. 로그인 제공업체

**Authentication → Sign-in method** 에서 **Google** 이 사용 설정되어 있는지 확인합니다.

### 1-4. Firestore 생성

**Firestore Database → 데이터베이스 만들기**

| 항목 | 값 |
|---|---|
| 모드 | **프로덕션 모드에서 시작** (테스트 모드는 30일 뒤 전부 잠깁니다) |
| 위치 | **asia-northeast3 (서울)** — 한 번 정하면 변경 불가 |

### 1-5. 보안 규칙 배포

**Firestore Database → 규칙** 탭에 [`firestore.rules`](../firestore.rules) 의 내용을
통째로 붙여넣고 **게시**합니다.

<br>

## 2. Cloudflare Pages

### 2-1. 프로젝트 2개 생성

1. [dash.cloudflare.com](https://dash.cloudflare.com) 무료 가입
2. **Compute (Workers & Pages)** → **Create** → **Pages** 탭 → **Upload assets**
3. 아래 두 개를 만듭니다. 프로젝트 이름이 그대로 주소가 됩니다.

| 프로젝트 이름 | 주소 | 용도 |
|---|---|---|
| `hk-gamehub` | hk-gamehub.pages.dev | 허브 |
| `hk-games` | hk-games.pages.dev | 수강생 게임 |

> **Git 연동이 아니라 Direct Upload 방식**으로 만들어야 합니다. 배포는 GitHub Actions 가
> wrangler 로 수행합니다. 생성 시에는 아무 파일이나 올려 초기화만 해두면 됩니다.

### 2-2. Account ID 복사

Workers & Pages 화면 오른쪽 사이드바에 **Account ID** 가 있습니다.

### 2-3. API 토큰 발급

1. 오른쪽 위 프로필 → **My Profile** → **API Tokens** → **Create Token**
2. **Create Custom Token**
3. 권한 설정

| 항목 | 값 |
|---|---|
| Permissions | `Account` → `Cloudflare Pages` → **Edit** |
| Account Resources | Include → 본인 계정 |

4. 토큰은 **생성 직후 한 번만** 표시됩니다.

### 2-4. GitHub Secrets 등록

레포 → **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 2-3 의 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | 2-2 의 Account ID |

<br>

## 3. 첫 배포

`main` 브랜치에 푸시하면 [`deploy.yml`](../.github/workflows/deploy.yml) 이 돌면서
빌드와 배포가 자동으로 진행됩니다. Actions 탭에서 결과를 확인할 수 있습니다.

<br>

## 이름을 다르게 쓰고 싶다면

프로젝트 이름을 `hk-gamehub` / `hk-games` 가 아닌 것으로 만들었다면 세 곳을 맞춰야 합니다.

| 파일 | 항목 |
|---|---|
| `hub/config.js` | `GAMES_ORIGIN` |
| `.github/workflows/deploy.yml` | `--project-name`, `HUB_ORIGIN` |
| Firebase 승인된 도메인 | 허브 주소 |

<br>

## 커스텀 도메인을 붙이는 경우

Cloudflare Pages 프로젝트마다 **Custom domains** 에서 각각 붙입니다.
이때도 **허브와 게임은 반드시 다른 도메인**이어야 합니다.

```
gamehub.example.com   → hk-gamehub
games.example.com     → hk-games
```

서브도메인끼리는 오리진이 다르므로 이 구성으로도 격리가 유지됩니다.
붙인 뒤 Firebase 승인된 도메인과 위 세 곳의 설정을 새 주소로 갱신하세요.
