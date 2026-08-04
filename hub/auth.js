// 수강생 인증
//
// 기존 학급 앱(HK_Betting 등)과 똑같은 방식을 쓴다. 허브만 다른 규칙을 쓰면
// 같은 이름·PIN 으로 로그인이 안 되는 상황이 생기기 때문이다.
//
//   문서 ID  : 이름을 trim → 소문자 → 공백을 _ 로
//   PIN 해시 : "pin_" + djb2(pin) 을 16진수로
//   Firebase : signInAnonymously (익명). 학급 신원은 Firestore 의 users 문서다.
//
// 주의: PIN 해시는 암호학적 해시가 아니고 users 컬렉션은 공개 읽기라, PIN 은
// 마음먹으면 알아낼 수 있다. 기존 시스템의 설계를 그대로 따른 것이고 허브가
// 이를 더 약하게 만들지는 않는다. 허브가 다루는 값은 좋아요뿐이라 포인트에는
// 영향이 없다.

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

// 이름으로 참가자 문서를 찾는다.
// 문서 ID 로 먼저 보고(읽기 1회), 없으면 name 필드로 조회한다.
// 기존 앱이 이름을 그대로 문서 ID 로 만든 경우와 나중에 이름만 바꾼 경우를 모두 잡기 위함.
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

export class LoginError extends Error {}

// 이름 + PIN 으로 로그인한다. 성공하면 { userId, name } 을 돌려준다.
export async function loginWithPin(fb, name, pin) {
  if (!String(name).trim()) throw new LoginError('이름을 입력하세요.');
  if (!String(pin).trim()) throw new LoginError('PIN 을 입력하세요.');

  const participant = await findParticipant(fb, name);
  if (!participant) {
    throw new LoginError('등록되지 않은 참가자입니다. 이름을 다시 확인해 주세요.');
  }
  if (participant.pinHash !== hashPin(pin)) {
    throw new LoginError('PIN 이 일치하지 않습니다.');
  }

  // Firestore 보안 규칙이 signedIn() 을 요구하므로 익명 로그인이 필요하다.
  // 이 익명 uid 는 학급 신원과 무관하며, 좋아요는 participant.id 로 기록된다.
  await fb.auths.signInAnonymously(fb.auth);

  return { userId: participant.id, name: participant.name || String(name).trim() };
}
