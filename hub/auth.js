// 수강생 인증
//
// 기존 학급 앱(HK_Betting 등)과 같은 방식이다. 이름·PIN 을 클라이언트에서 대조하고
// Firebase 는 익명 로그인만 쓴다. 학급 신원(userId)은 Firestore 의 users 문서다.
//
//   문서 ID  : 이름을 trim → 소문자 → 공백을 _ 로
//   PIN 해시 : "pin_" + djb2(pin) 을 16진수로
//   Firebase : signInAnonymously (익명)
//
// 트레이드오프: request.auth.uid 가 익명 uid 라 보안 규칙이 "이 사람이 정말
// 이 참가자인가" 를 확인하지 못한다. 즉 PIN 없이도 브라우저 콘솔로 남의 이름
// 좋아요 문서를 만들 수 있다. 카운터는 참가자당 1문서·실제 문서가 있어야 +1
// 이라 UI 로는 자기 것만 눌리고 조작하려면 콘솔을 직접 파야 하지만, 규칙 수준의
// 원천 차단은 아니다. 소규모 신뢰 환경을 전제로 한 선택이다. 원천 차단이
// 필요하면 PIN 을 서버에서 검증해 커스텀 토큰을 발급하는 함수를 다시 붙이면 된다.
//
// 슬러그·해시 함수는 기존 학급 앱과 결과가 완전히 같아야 같은 이름·PIN 으로
// 로그인된다.

const SESSION_KEY = 'hkgamehub.session';

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

// 이름으로 참가자 문서를 찾는다.
// 문서 ID 로 먼저 보고(읽기 1회), 없으면 name 필드로 조회한다.
async function findParticipant(fb, name) {
  const { doc, getDoc, collection, query, where, limit, getDocs } = fb.fs;

  const id = participantId(name);
  const byId = await getDoc(doc(fb.db, 'users', id));
  if (byId.exists()) return { id: byId.id, ...byId.data() };

  const snap = await getDocs(query(
    collection(fb.db, 'users'),
    where('name', '==', String(name).trim()),
    limit(1),
  ));
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

  return null;
}

// 이름 + PIN 으로 로그인한다. 성공하면 { userId, name } 을 돌려준다.
export async function loginWithPin(fb, name, pin) {
  if (!String(name).trim()) throw new LoginError('이름을 입력하세요.');
  if (!String(pin).trim()) throw new LoginError('PIN 을 입력하세요.');

  const participant = await findParticipant(fb, name);
  if (!participant) {
    throw new LoginError('등록되지 않은 참가자입니다. 이름을 다시 확인해 주세요.');
  }
  if (!participant.pinHash || participant.pinHash !== hashPin(pin)) {
    throw new LoginError('PIN 이 일치하지 않습니다.');
  }

  const session = { userId: participant.id, name: participant.name || String(name).trim() };

  // signInAnonymously 는 onAuthStateChanged 를 깨우고, 그 핸들러는 세션에서 신원을
  // 읽는다. 그러니 로그인 전에 세션을 먼저 저장해 경쟁 조건을 없앤다.
  saveSession(session);

  // Firestore 보안 규칙이 signedIn() 을 요구하므로 익명 로그인이 필요하다.
  // 이 익명 uid 는 학급 신원과 무관하며, 좋아요는 participant.id 로 기록된다.
  await fb.auths.signInAnonymously(fb.auth);

  return session;
}
