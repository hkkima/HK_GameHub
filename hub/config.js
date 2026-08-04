// HK GameHub 설정
//
// 여기 있는 값은 전부 공개되어도 되는 식별자다.
// Firebase 웹 config 는 비밀키가 아니며, 실제 접근 통제는 firestore.rules 가 한다.

// ---------------------------------------------------------------------------
// 1. Firebase (hk_hub 프로젝트)
//    콘솔 > 프로젝트 설정 > 일반 > 내 앱 > SDK 설정 및 구성 > 구성
//    에서 복사한 값으로 아래를 교체할 것.
// ---------------------------------------------------------------------------
export const firebaseConfig = {
  apiKey: 'TODO_REPLACE_ME',
  authDomain: 'TODO_REPLACE_ME.firebaseapp.com',
  projectId: 'TODO_REPLACE_ME',
  storageBucket: 'TODO_REPLACE_ME.appspot.com',
  messagingSenderId: 'TODO_REPLACE_ME',
  appId: 'TODO_REPLACE_ME',
};

// ---------------------------------------------------------------------------
// 2. 게임이 서빙되는 오리진
//
//    허브와 반드시 달라야 한다. 수강생이 만든 임의의 JS 가 허브와 같은 오리진에서
//    돌면 IndexedDB 에 있는 Firebase 인증 토큰을 읽어 다른 사람을 사칭할 수 있다.
//    *.pages.dev 는 Public Suffix List 에 있어서 프로젝트를 나누면 완전히 분리된다.
// ---------------------------------------------------------------------------
//    로컬 개발(npm run dev)에서는 허브 5173 / 게임 5174 로 포트를 나눠 띄우므로
//    브라우저 기준으로는 이때도 서로 다른 오리진이 된다.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

export const GAMES_ORIGIN = LOCAL
  ? `${location.protocol}//${location.hostname}:5174`
  : 'https://hk-games.pages.dev';

// 갤러리에 표시할 문구
export const SITE = {
  title: 'HK GameHub',
  tagline: '기획 수강생들이 만든 웹 게임 모음',
};
