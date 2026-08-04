// 수강생 인증
//
// 이름·PIN 은 gamehubLogin Cloud Function 이 서버에서 검증하고, uid 가 참가자 ID 인
// 커스텀 토큰을 돌려준다. 클라이언트는 그 토큰으로 로그인한다.
//
// 서버 검증이 필요한 이유는 좋아요 1건이 포인트로 환산되기 때문이다. 클라이언트에서
// pinHash 를 대조하는 방식(기존 학급 앱)으로는 request.auth.uid 가 익명 uid 라
// 보안 규칙이 본인 확인을 할 수 없고, 남의 이름으로 좋아요를 눌러 포인트를 만들어
// 낼 수 있다. 커스텀 토큰이면 uid == 참가자 ID 라 규칙이 이를 막는다.
//
// 슬러그·해시 함수는 서버(functions/index.js)에도 같은 구현이 있다. 기존 학급 앱과
// 결과가 완전히 같아야 같은 이름·PIN 으로 로그인된다.

const SESSION_KEY = 'hkgamehub.session';
export const FUNCTIONS_REGION = 'asia-northeast3';

// 기존 앱의 $i() 와 동일해야 한다
export function participantId(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
}

// 기존 앱의 Iu() 와 동일해야 한다 (djb2)
export function hashPin(pin) {
  const s = String(pin);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33) ^ s.charCodeAt(i);
  return 'pin_' + (h >>> 0).toString(16);
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.userId && s.name ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* 시크릿 모드 등에서 실패해도 이번 세션은 그대로 쓴다 */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch { /* 무시 */ }
}

export class LoginError extends Error {}

// 이름 + PIN 으로 로그인한다. 성공하면 { userId, name } 을 돌려준다.
export async function loginWithPin(fb, name, pin) {
  if (!String(name).trim()) throw new LoginError('이름을 입력하세요.');
  if (!String(pin).trim()) throw new LoginError('PIN 을 입력하세요.');

  let result;
  try {
    const login = fb.fns.httpsCallable(fb.functions, 'gamehubLogin');
    result = await login({ name: String(name).trim(), pin: String(pin) });
  } catch (err) {
    // 함수가 던진 HttpsError 는 사용자에게 그대로 보여줘도 되는 문구다
    if (err?.code === 'functions/not-found' || err?.code === 'functions/permission-denied'
        || err?.code === 'functions/invalid-argument') {
      throw new LoginError(err.message);
    }
    throw err;
  }

  const { token, userId, name: displayName } = result.data || {};
  if (!token) throw new LoginError('로그인 응답이 올바르지 않습니다.');

  await fb.auths.signInWithCustomToken(fb.auth, token);

  return { userId, name: displayName || String(name).trim() };
}
