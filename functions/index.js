// HK GameHub 전용 Cloud Functions
//
// ★ 이 파일은 firebase.json 에서 codebase "gamehub" 로 분리되어 있다. ★
//   같은 프로젝트에 베팅·주식·홀덤 등 다른 함수들이 이미 배포되어 있는데,
//   codebase 를 나눠 두면 `--only functions:gamehub` 배포가 그쪽 함수들을
//   건드리지 않는다. 절대 codebase 필터 없이 배포하지 말 것.
//
// 하는 일
//   gamehubLogin  이름·PIN 을 서버에서 검증하고 커스텀 토큰을 발급한다.
//                 클라이언트가 이 토큰으로 로그인하면 request.auth.uid 가
//                 참가자 ID 와 같아져서, 보안 규칙이 본인 확인을 할 수 있다.
//                 좋아요에 포인트가 걸리는 이상 이게 없으면 남의 이름으로
//                 좋아요를 눌러 포인트를 만들어 낼 수 있다.
//
//   gamehubPayout 운영자가 주간 승인 시 호출한다. 아직 지급되지 않은 좋아요를
//                 모아 게임 제작자에게 포인트를 준다. 좋아요 문서에 회차를
//                 표시해 두므로 두 번 눌러도 중복 지급되지 않는다.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

const REGION = 'asia-northeast3';
const GAMES_COL = 'gamehub_games';
const PAYOUTS_COL = 'gamehub_payouts';

// firestore.rules 의 isAdmin() 과 같은 목록을 유지할 것
const ADMIN_EMAILS = ['jetsomk22@gmail.com'];

// 갤러리 메타데이터의 정본. 빌드가 만들어 Cloudflare Pages 에 올린다.
const GAMES_JSON = 'https://hk-gamehub.pages.dev/games.json';

const DEFAULT_POINTS_PER_LIKE = 500;
const BATCH_LIMIT = 450; // Firestore 배치 상한 500 에서 여유를 둔다

// ---------------------------------------------------------------------------
// 기존 학급 앱(HK_Betting)과 동일해야 하는 함수들.
// 하나라도 다르면 같은 이름·PIN 으로 로그인이 되지 않는다.
// hub/auth.js 에도 같은 구현이 있다.
// ---------------------------------------------------------------------------

function participantId(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function hashPin(pin) {
  const s = String(pin);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33) ^ s.charCodeAt(i);
  return 'pin_' + (h >>> 0).toString(16);
}

// ---------------------------------------------------------------------------
// 로그인
// ---------------------------------------------------------------------------

async function findParticipant(name) {
  const id = participantId(name);

  const byId = await db.collection('users').doc(id).get();
  if (byId.exists) return { id: byId.id, ...byId.data() };

  const byName = await db.collection('users')
    .where('name', '==', String(name).trim())
    .limit(1)
    .get();
  if (!byName.empty) return { id: byName.docs[0].id, ...byName.docs[0].data() };

  return null;
}

export const gamehubLogin = onCall({ region: REGION, cors: true }, async (req) => {
  const name = String(req.data?.name ?? '').trim();
  const pin = String(req.data?.pin ?? '');

  if (!name) throw new HttpsError('invalid-argument', '이름을 입력하세요.');
  if (!pin) throw new HttpsError('invalid-argument', 'PIN 을 입력하세요.');

  const participant = await findParticipant(name);
  if (!participant) {
    throw new HttpsError('not-found', '등록되지 않은 참가자입니다. 이름을 다시 확인해 주세요.');
  }
  if (!participant.pinHash || participant.pinHash !== hashPin(pin)) {
    // 이름이 있는지 없는지까지 구분해 알려주지는 않는다
    throw new HttpsError('permission-denied', 'PIN 이 일치하지 않습니다.');
  }

  // uid 를 참가자 ID 로 못박는다. 이 토큰으로 로그인하면 보안 규칙에서
  // request.auth.uid == 참가자 ID 가 성립한다.
  const token = await getAuth().createCustomToken(participant.id, { participant: true });

  return {
    token,
    userId: participant.id,
    name: participant.name || name,
  };
});

// ---------------------------------------------------------------------------
// 주간 지급
// ---------------------------------------------------------------------------

function assertAdmin(req) {
  const email = req.auth?.token?.email;
  if (!email || !ADMIN_EMAILS.includes(email)) {
    throw new HttpsError('permission-denied', '운영자만 실행할 수 있습니다.');
  }
  return email;
}

async function loadGames() {
  const res = await fetch(GAMES_JSON, { cache: 'no-store' });
  if (!res.ok) throw new HttpsError('unavailable', `games.json 을 불러오지 못했습니다 (${res.status}).`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.games || []);
}

// 아직 지급되지 않은 좋아요를 게임별로 모은다.
async function collectUnpaid(games) {
  const perGame = [];

  for (const game of games) {
    const snap = await db.collection(GAMES_COL).doc(game.slug)
      .collection('likes').where('paidIn', '==', null).get();
    if (snap.empty) continue;

    perGame.push({
      slug: game.slug,
      title: game.title,
      authorId: game.authorId || '',
      likeRefs: snap.docs.map((d) => d.ref),
      likedBy: snap.docs.map((d) => d.id),
    });
  }

  return perGame;
}

export const gamehubPayout = onCall({ region: REGION, cors: true }, async (req) => {
  const approvedBy = assertAdmin(req);

  const dryRun = req.data?.dryRun !== false; // 기본은 미리보기. 지급은 명시적으로 요청해야 한다.
  const pointsPerLike = Number.isInteger(req.data?.pointsPerLike)
    ? req.data.pointsPerLike
    : DEFAULT_POINTS_PER_LIKE;

  if (pointsPerLike <= 0 || pointsPerLike > 100000) {
    throw new HttpsError('invalid-argument', '1 좋아요당 포인트가 올바르지 않습니다.');
  }

  const games = await loadGames();
  const pending = await collectUnpaid(games);

  // 제작자별 합산. manifest 에 authorId 가 없거나 참가자가 실재하지 않으면 건너뛴다.
  const rows = [];
  const problems = [];

  for (const g of pending) {
    if (!g.authorId) {
      problems.push(`${g.slug}: manifest.json 에 authorId 가 없어 지급 대상에서 제외했습니다.`);
      continue;
    }
    const author = await db.collection('users').doc(g.authorId).get();
    if (!author.exists) {
      problems.push(`${g.slug}: 참가자 '${g.authorId}' 를 찾을 수 없어 제외했습니다.`);
      continue;
    }
    rows.push({
      slug: g.slug,
      title: g.title,
      authorId: g.authorId,
      authorName: author.data().name || g.authorId,
      likes: g.likeRefs.length,
      likedBy: g.likedBy,
      points: g.likeRefs.length * pointsPerLike,
      likeRefs: g.likeRefs,
    });
  }

  const totalLikes = rows.reduce((n, r) => n + r.likes, 0);
  const totalPoints = totalLikes * pointsPerLike;

  const preview = {
    dryRun,
    pointsPerLike,
    totalLikes,
    totalPoints,
    problems,
    rows: rows.map(({ likeRefs, ...r }) => r),
  };

  if (dryRun || totalLikes === 0) return preview;

  // ── 실제 지급 ────────────────────────────────────────────────────────────
  const payoutRef = db.collection(PAYOUTS_COL).doc();
  const now = FieldValue.serverTimestamp();

  // 참가자별로 합산해 balance 를 한 번만 올린다 (한 사람이 여러 게임을 냈을 수 있다)
  const byAuthor = new Map();
  for (const r of rows) {
    const cur = byAuthor.get(r.authorId) || { likes: 0, points: 0, name: r.authorName };
    cur.likes += r.likes;
    cur.points += r.points;
    byAuthor.set(r.authorId, cur);
  }

  const ops = [];

  for (const [authorId, agg] of byAuthor) {
    ops.push((batch) => {
      batch.update(db.collection('users').doc(authorId), {
        balance: FieldValue.increment(agg.points),
      });
    });
    // 기존 감사 원장과 같은 형식으로 남긴다 ({ userId, type, delta, ts })
    ops.push((batch) => {
      batch.set(db.collection('ledger').doc(), {
        userId: authorId,
        type: 'gamehub_like',
        delta: agg.points,
        likes: agg.likes,
        payoutId: payoutRef.id,
        ts: now,
      });
    });
  }

  for (const r of rows) {
    for (const ref of r.likeRefs) {
      ops.push((batch) => { batch.update(ref, { paidIn: payoutRef.id }); });
    }
  }

  ops.push((batch) => {
    batch.set(payoutRef, {
      approvedBy,
      approvedAt: now,
      pointsPerLike,
      totalLikes,
      totalPoints,
      games: rows.map((r) => ({
        slug: r.slug,
        authorId: r.authorId,
        likes: r.likes,
        points: r.points,
      })),
    });
  });

  // 순서가 중요하다. 잔액 증가와 좋아요 표시가 먼저고 회차 요약이 마지막이다.
  // 도중에 실패하면 "지급은 됐는데 요약 문서가 없는" 상태로 남는데, 이미 표시된
  // 좋아요는 다음 실행에서 제외되므로 중복 지급은 일어나지 않는다. 반대 순서로
  // 두면 실패 시 중복 지급 위험이 생긴다. 학급 규모에서는 대개 배치 하나로 끝난다.
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const apply of ops.slice(i, i + BATCH_LIMIT)) apply(batch);
    await batch.commit();
  }

  return { ...preview, dryRun: false, payoutId: payoutRef.id };
});
