# 최초 세팅 가이드

운영자가 한 번만 하면 되는 작업입니다. 전부 무료이고 신용카드도 필요 없습니다.

<br>

## 1. Firebase

사용하는 프로젝트는 **`hk-chess-betting`** 입니다. 수강생 계정이 이미 들어 있는
프로젝트라 그대로 재사용합니다. (Firebase 프로젝트 ID 는 변경할 수 없어서
표시 이름과 용도가 달라 보여도 ID 는 그대로입니다.)

### 1-1. 웹 앱 config

[`hub/config.js`](../hub/config.js) 에 이미 반영되어 있습니다. 값이 바뀌면
**프로젝트 설정 → 일반 → 내 앱 → SDK 설정 및 구성 → 구성** 에서 다시 가져오세요.

> 이 값들은 **공개되어도 되는 식별자**입니다. 비밀키가 아니며 레포에 커밋해도 됩니다.
> 실제 접근 통제는 `firestore.rules` 가 담당합니다.

### 1-2. 승인된 도메인 추가

**Authentication → 설정 → 승인된 도메인** 에 다음을 추가합니다.

```
hk-gamehub.pages.dev
```

이걸 빠뜨리면 로그인 팝업이 `auth/unauthorized-domain` 으로 실패합니다.

### 1-3. 로그인 제공업체

**Authentication → Sign-in method** 에서 **익명(Anonymous)** 이 사용 설정되어 있는지
확인합니다. 기존 학급 앱(HK_Betting 등)이 이미 쓰고 있으므로 대개 켜져 있습니다.

허브의 수강생 로그인은 기존 앱과 똑같은 방식입니다.

```
이름·PIN 입력 → users/{이름슬러그}.pinHash 대조 → signInAnonymously()
```

Firebase 계정은 익명이고, 학급 신원은 Firestore 의 `users` 문서입니다.
Google 로그인은 운영자용이라 허브에서는 쓰지 않습니다.

### 1-4. Firestore 생성

이 프로젝트에는 이미 **Realtime Database** 가 있습니다(`asia-southeast1`).
Firestore 는 그와 **별개의 서비스**라 같은 프로젝트에 추가해도 기존 RTDB 데이터에는
아무 영향이 없고, 둘 다 무료 한도가 따로 적용됩니다.

**Firestore Database → 데이터베이스 만들기**

| 항목 | 값 |
|---|---|
| 모드 | **프로덕션 모드에서 시작** (테스트 모드는 30일 뒤 전부 잠깁니다) |
| 위치 | **asia-northeast3 (서울)** — 한 번 정하면 변경 불가 |

> 좋아요를 RTDB 로 처리하지 않고 Firestore 를 쓰는 이유는 두 가지입니다.
> 하나는 카운터 조작 방지에 쓰는 `getAfter()` 가 Firestore 규칙에만 있다는 점,
> 다른 하나는 RTDB 무료 한도의 **동시 접속 100 제한** 입니다. 발표일처럼 한꺼번에
> 몰리는 상황에서 Firestore 는 이 제한이 없습니다.

### 1-5. 보안 규칙

⚠ **이 Firestore 는 여러 앱이 공유합니다.** 베팅판, 주식판, 코딩 문제판(HK_Judge),
외주 게시판(HK_Board), 팀 경제, 홀덤 리그, DP 교환소가 같은 데이터베이스를 씁니다.
Firestore 는 **프로젝트당 규칙이 하나뿐**이라, 규칙을 배포하면 그 앱들의 접근 통제까지
한꺼번에 갈아치웁니다.

레포의 [`firestore.rules`](../firestore.rules) 는 **기존 규칙 전체 + 게임허브 블록**을
합친 통합본입니다. 게임허브 부분만 들어 있는 파일이 아닙니다.

배포는 워크플로로 합니다.

**Actions → Firestore 규칙 → Run workflow → `deploy` 선택**

배포 전에 `dump` 로 현재 배포본을 먼저 확인하는 것이 안전합니다. 다른 레포에서
규칙을 바꿨다면 그 변경분을 이 파일에 먼저 반영해야 합니다.

> **다른 레포에서 규칙을 배포할 때는 이 파일의 `게임 허브 (HK_GameHub)` 블록을
> 그쪽에도 옮기세요.** 옮기지 않고 배포하면 그 순간 좋아요가 동작을 멈춥니다.
> 이건 Firestore 의 구조적 제약이라 피할 방법이 없습니다.

허브가 쓰는 컬렉션은 `gamehub_games`, `gamehub_users` 두 개뿐이고 접두사가
붙어 있어, 기존 `users` 등과 이름이 겹치지 않습니다.

<br>

## 2. Cloudflare Pages

### 2-1. 프로젝트 생성 — 할 일 없음

**대시보드에서 손으로 만들 필요가 없습니다.** 워크플로가 배포 직전에
`wrangler pages project create` 로 아래 두 개를 알아서 만듭니다.

| 프로젝트 이름 | 주소 | 용도 |
|---|---|---|
| `hk-gamehub` | hk-gamehub.pages.dev | 허브 |
| `hk-games` | hk-games.pages.dev | 수강생 게임 |

이미 존재하면 그 단계는 실패하지만 `continue-on-error` 로 넘어가므로,
몇 번을 돌려도 안전합니다.

> 굳이 대시보드에서 만들고 싶다면 **Workers & Pages → Create application →
> Pages 탭 → Upload assets** 순서입니다. 다만 Cloudflare 가 이 화면 구성을
> 자주 바꾸고 있어, CLI 로 맡기는 쪽이 안정적입니다.

### 2-2. Account ID 복사

Workers & Pages 화면 오른쪽 사이드바에 **Account ID** 가 있습니다.

### 1-6. 서비스 계정 권한 (함수 배포용)

좋아요 포인트 기능부터는 Cloud Functions 를 배포해야 해서, `github-firestore-rules`
서비스 계정에 권한을 더 줘야 합니다. [IAM 페이지](https://console.cloud.google.com/iam-admin/iam?project=hk-chess-betting)
에서 다음을 추가하세요. (아래는 실제 배포에서 하나씩 막히며 확정한 목록입니다.)

| 역할 | 용도 |
|---|---|
| `Firebase Rules 관리자` | 기존 — 보안 규칙 |
| `Firebase 관리자` | Firebase 프로젝트 조회·함수·확장 관리 (여러 하위 API 를 한 번에 커버) |
| `Cloud Functions 관리자` | 함수 생성·갱신 |
| `서비스 계정 사용자` | 함수 실행 계정 지정 |
| `Cloud Run 관리자` | 2세대 함수는 Cloud Run 위에서 돈다 |
| `Artifact Registry 관리자` | 함수 이미지 저장 |
| `Cloud Build 편집자` | 함수 빌드 |

그리고 [Cloud Billing API](https://console.cloud.google.com/apis/library/cloudbilling.googleapis.com?project=hk-chess-betting)
를 콘솔에서 **한 번 켜 주세요**. 서비스 계정 권한으로는 켤 수 없고, `firebase-tools`
가 2세대 함수 배포 전 요금제 확인에 씁니다. (요금 부과 방식과는 무관한 조회용 API 입니다.)

> ⚠ **규칙만 다룰 때보다 훨씬 넓은 권한입니다.** 이 계정으로 코드를 배포할 수 있게
> 됩니다. 함수를 자주 고칠 일이 없다면, 배포가 끝난 뒤 추가 역할만 회수하고
> `Firebase Rules 관리자` 만 남겨두셔도 됩니다.
>
> 로그인용 커스텀 토큰 함수를 다시 붙이는 경우에만, 함수 **런타임** 서비스 계정
> (`<프로젝트번호>-compute@developer.gserviceaccount.com`)에 `Service Account
> Token Creator` 역할이 추가로 필요합니다. 현재 구성(익명 로그인)에서는 불필요합니다.

### 1-7. 멀티파일 업로드 (선택) — GitHub 토큰

수강생이 여러 파일(React 등) 게임을 허브에서 바로 올리게 하려면, 함수가 대신
GitHub 에 PR 을 만들 수 있어야 합니다.

1. [Fine-grained PAT 발급](https://github.com/settings/personal-access-tokens/new)
   - Resource owner: `hkkima`, Repository: `HK_GameHub` 만
   - Permissions: **Contents** = Read and write, **Pull requests** = Read and write
2. 레포 **Settings → Secrets and variables → Actions** 에 `GH_SUBMIT_TOKEN` 으로 등록
3. 서비스 계정 `github-firestore-rules` 에 **`Secret Manager 관리자`** 역할 추가
   (워크플로가 이 토큰을 Secret Manager 에 넣고 함수에 바인딩합니다)

이 셋을 하지 않으면 단일 HTML 즉시 게시는 그대로 되고, 멀티파일 업로드만
비활성화됩니다(함수가 `failed-precondition` 을 반환).

### 1-8. 함수 배포

**Actions → Firebase 배포 → Run workflow → `deploy-functions`**

`gamehubPayout`(주간 지급)과 `gamehubSubmit`(멀티파일 제출) 함수가 올라갑니다.
로그인은 함수를 쓰지 않습니다(수강생은 익명 로그인 + 클라이언트 PIN 대조).

> 함수는 `firebase.json` 에서 **codebase `gamehub`** 로 분리되어 있고, 배포도
> `--only functions:gamehub` 로 그 codebase 만 대상으로 합니다. 베팅·홀덤 등
> 다른 앱의 함수는 이 워크플로가 건드리지 않습니다.
>
> **직접 배포하실 때도 반드시 codebase 필터를 붙이세요.** 필터 없이
> `firebase deploy --only functions` 를 돌리면 이 레포에 없는 함수들이 삭제 대상이 됩니다.

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
