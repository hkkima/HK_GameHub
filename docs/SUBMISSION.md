# 내 게임 올리기

만든 웹 게임을 [HK GameHub](https://hk-gamehub.pages.dev) 에 전시하는 방법입니다.

<br>

## 1. 폴더 만들기

`apps/` 아래에 **내 게임 폴더**를 하나 만듭니다. 폴더 이름이 곧 주소가 됩니다.

```
apps/
  jihoon-dungeon/        ← 영소문자, 숫자, 하이픈만 사용
    manifest.json
    index.html
```

> 이름은 `기수-이름-게임` 처럼 겹치지 않게 지어 주세요. 예: `11-jihoon-dungeon`

<br>

## 2. manifest.json 작성

게임 정보입니다. 갤러리 카드에 이 내용이 표시됩니다.

```json
{
  "title": "던전 러너",
  "author": "김지훈",
  "cohort": "11기",
  "description": "한두 문장으로 게임을 소개합니다.",
  "tags": ["액션", "로그라이크"],
  "thumb": "thumb.png",
  "spa": false
}
```

| 항목 | 필수 | 설명 |
|---|---|---|
| `title` | ✅ | 게임 이름 |
| `author` | ✅ | 제작자 이름 |
| `cohort` | | 기수 |
| `description` | | 소개 문구 (카드에 두 줄까지 표시) |
| `tags` | | 태그 배열. 갤러리에서 필터로 쓰입니다 |
| `thumb` | | 썸네일 파일 경로. 없으면 자동 생성됩니다 (권장 16:10) |
| `spa` | | React Router 등 클라이언트 라우팅을 쓰면 `true` |

<br>

## 3-A. index.html 하나로 된 게임

Claude 가 만들어 준 단일 HTML 파일이라면 **그냥 `index.html` 로 넣으면 끝입니다.**

```
apps/jihoon-dungeon/
  manifest.json
  index.html
  thumb.png
```

<br>

## 3-B. React 등 빌드가 필요한 앱

`package.json` 이 있으면 CI 가 자동으로 감지해서 빌드합니다. 소스를 그대로 넣으세요.

```
apps/minseo-rpg/
  manifest.json
  package.json
  vite.config.js
  src/ ...
```

### 반드시 지켜야 할 것 두 가지

**1) 에셋 경로를 상대 경로로**

게임은 `/g/<폴더이름>/` 하위에 배포됩니다. 기본 설정 그대로 두면 `/assets/...` 를
찾다가 화면이 하얗게 뜹니다.

```js
// vite.config.js
export default {
  base: './',   // ← 이 한 줄
}
```

Create React App 이라면 `package.json` 에 `"homepage": "."` 를 넣습니다.

**2) `npm run build` 가 통과해야 함**

CI 는 `npm run build` 를 실행하고 산출물 폴더(`dist`, `build`, `out`, `public` 중
`index.html` 이 있는 곳)를 가져갑니다. 다른 이름을 쓴다면 `manifest.json` 에
`"outDir": "폴더이름"` 을 적어 주세요.

> **보안상 `postinstall` 같은 라이프사이클 스크립트는 실행되지 않습니다**(`--ignore-scripts`).
> 빌드가 그런 스크립트에 의존하지 않도록 해주세요.

<br>

## 4. PR 올리기

```bash
git checkout -b add-jihoon-dungeon
git add apps/jihoon-dungeon
git commit -m "add: 던전 러너"
git push -u origin add-jihoon-dungeon
```

PR 을 올리면 CI 가 자동으로 빌드를 검증합니다. **초록불이 뜨면 배포 준비 완료**입니다.
빨간불이면 Actions 로그에 어디가 잘못됐는지 한국어로 나옵니다.

머지되면 몇 분 안에 갤러리에 올라갑니다.

<br>

## 게임 만들 때 알아두면 좋은 것

**저장 기능**
`localStorage` 를 자유롭게 쓸 수 있습니다. 최고점수, 진행상황 저장 모두 됩니다.
다만 게임끼리 같은 저장 공간을 공유하므로, 키 이름 앞에 게임 이름을 붙여 주세요.

```js
localStorage.setItem('jihoon-dungeon:highscore', score);
```

**화면 크기**
게임은 iframe 안에서 열립니다. 창 크기에 반응하도록 만들면 좋습니다.
고정 크기라면 `width: 100%; height: 100dvh` 정도로 감싸 주세요.

**외부 리소스**
CDN 폰트, 이미지 등은 자유롭게 쓸 수 있습니다. 다만 파일 하나가 **25MB** 를 넘으면
배포되지 않으니 큰 에셋은 압축해 주세요.

**하면 안 되는 것**
게임 안에서 부모 창(허브)에 접근하려는 시도는 브라우저가 차단합니다.
`window.parent`, `window.top` 은 쓸 수 없습니다.

<br>

## 자주 나오는 문제

| 증상 | 원인 |
|---|---|
| 화면이 하얗게 나옴 | `base: './'` 를 안 넣었을 가능성이 큽니다 |
| 이미지가 안 뜸 | 절대 경로(`/img/a.png`)를 상대 경로(`./img/a.png`)로 바꾸세요 |
| CI 빨간불 | Actions 로그 맨 아래 `✗` 로 시작하는 줄을 확인하세요 |
| 새로고침하면 404 | 클라이언트 라우팅을 쓴다면 `manifest.json` 에 `"spa": true` |
