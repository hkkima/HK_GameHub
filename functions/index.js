// HK GameHub 전용 Cloud Functions
//
// ★ 이 파일은 firebase.json 에서 codebase "gamehub" 로 분리되어 있다. ★
//   같은 프로젝트에 베팅·주식·홀덤 등 다른 함수들이 이미 배포되어 있는데,
//   codebase 를 나눠 두면 `--only functions:gamehub` 배포가 그쪽 함수들을
//   건드리지 않는다. 절대 codebase 필터 없이 배포하지 말 것.
//
// 하는 일
//   gamehubPayout 운영자가 주간 승인 시 호출한다. 아직 지급되지 않은 좋아요를
//                 모아 게임 제작자에게 포인트를 준다. 좋아요 문서에 회차를
//                 표시해 두므로 두 번 눌러도 중복 지급되지 않는다.
//
// 로그인은 함수를 쓰지 않는다. 수강생은 다른 학급 앱과 같이 클라이언트에서
// 이름·PIN 을 대조하고 익명 로그인만 한다(hub/auth.js). 잔액을 실제로 늘리는
// 것은 여기 gamehubPayout 뿐이므로, 로그인 신원과 무관하게 포인트 무결성은
// 이 함수가 지킨다.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
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

// 멀티파일 게임을 PR 로 올릴 때 GitHub 에 커밋할 토큰(Fine-grained PAT).
// Secret Manager 에 저장하고 배포 시 함수에 바인딩한다.
const GH_SUBMIT_TOKEN = defineSecret('GH_SUBMIT_TOKEN');
const REPO_OWNER = 'hkkima';
const REPO_NAME = 'HK_GameHub';
const REPO_BRANCH = 'main';

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

// 정식 배포(Cloudflare) 게임 목록.
async function loadCloudflareGames() {
  const res = await fetch(GAMES_JSON, { cache: 'no-store' });
  if (!res.ok) throw new HttpsError('unavailable', `games.json 을 불러오지 못했습니다 (${res.status}).`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.games || []);
}

// 즉시 게시 게임 목록(Firestore). 좋아요는 두 경로가 같은 gamehub_games/{slug} 에
// 쌓이므로, 지급도 두 목록을 합쳐서 순회해야 즉시 게시 게임이 누락되지 않는다.
async function loadInstantGames() {
  const snap = await db.collection('gamehub_instant').get();
  return snap.docs.map((d) => ({
    slug: d.id,
    title: d.data().title || d.id,
    authorId: d.data().authorId || '',
  }));
}

// 두 소스를 합친다. 같은 slug 면 한 번만(정식 배포 우선).
async function loadAllGames() {
  const [cf, instant] = await Promise.all([loadCloudflareGames(), loadInstantGames()]);
  const seen = new Set(cf.map((g) => g.slug));
  return [...cf, ...instant.filter((g) => !seen.has(g.slug))];
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

  const games = await loadAllGames();
  const pending = await collectUnpaid(games);

  // 제작자별 합산. manifest 에 authorId 가 없거나 참가자가 실재하지 않으면 건너뛴다.
  const rows = [];
  const problems = [];

  for (const g of pending) {
    if (!g.authorId) {
      problems.push(`${g.title}: 제작자(authorId)가 없어 지급 대상에서 제외했습니다.`);
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

// ---------------------------------------------------------------------------
// 멀티파일 게임 제출 (여러 파일 / React)
//
//   수강생이 허브에서 폴더를 올리면, 이 함수가 GitHub 에 apps/<slug>/ 로 커밋하고
//   PR 을 만든 뒤 자동 머지한다. 머지되면 CI(deploy.yml)가 빌드해 Cloudflare 에
//   배포하고 games.json 에 등장한다.
//
//   신뢰 모델은 나머지와 같다. auth 는 익명이라 서버가 누구인지 모르고, authorId 는
//   클라이언트가 보낸 값을 그대로 쓴다(실재 참가자인지만 확인). 소규모 학급 전제.
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,60}$/;
const MAX_FILES = 300;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
// 커밋해도 안전한 텍스트/자산 확장자만 받는다. 실행 파일·아카이브 등은 막는다.
const ALLOWED_EXT = new Set([
  'html', 'htm', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'css', 'scss',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif', 'bmp',
  'mp3', 'ogg', 'wav', 'm4a', 'mp4', 'webm', 'woff', 'woff2', 'ttf', 'otf',
  'txt', 'md', 'map', 'wasm', 'glb', 'gltf', 'fnt', 'xml', 'csv',
  'vue', 'svelte', 'lock', 'yml', 'yaml', 'env', 'gitignore', 'npmrc',
]);

function ghSlug(title, authorId) {
  const base = `${authorId}-${title}`.toLowerCase()
    .normalize('NFKD').replace(/[^\x00-\x7f]/g, '') // 아스키만(파일 경로·CI 안전)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const short = base.slice(0, 40).replace(/-+$/g, '') || 'game';
  // 충돌을 피하려고 짧은 접미사를 붙인다. crypto 는 함수 런타임에서 쓸 수 있다.
  const suffix = (globalThis.crypto?.randomUUID?.() || `${Date.now()}`).replace(/\D/g, '').slice(0, 6);
  return `${short}-${suffix}`;
}

function safeRelPath(p) {
  const clean = String(p).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('..') || clean.startsWith('.git/') || clean === '.git') return null;
  if (/[\x00-\x1f]/.test(clean)) return null;
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  // 확장자 없는 파일은 흔한 설정 파일 이름만 허용
  const bare = clean.split('/').pop();
  if (!ext && !['LICENSE', 'Procfile', 'Dockerfile'].includes(bare)) return null;
  if (ext && !ALLOWED_EXT.has(ext)) return null;
  return clean;
}

async function gh(token, method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`GitHub ${method} ${path} → ${res.status}: ${data.message || text}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const gamehubSubmit = onCall(
  { region: REGION, cors: true, secrets: [GH_SUBMIT_TOKEN], timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const token = GH_SUBMIT_TOKEN.value();
    if (!token) throw new HttpsError('failed-precondition', '제출 기능이 아직 설정되지 않았습니다.');

    const meta = req.data?.meta || {};
    const title = String(meta.title || '').trim();
    const authorId = String(meta.authorId || '').trim();
    const files = Array.isArray(req.data?.files) ? req.data.files : [];

    if (!title) throw new HttpsError('invalid-argument', '제목이 필요합니다.');
    if (!authorId) throw new HttpsError('invalid-argument', '제작자 정보가 필요합니다.');
    if (!files.length) throw new HttpsError('invalid-argument', '파일이 없습니다.');
    if (files.length > MAX_FILES) throw new HttpsError('invalid-argument', `파일이 너무 많습니다(${files.length} > ${MAX_FILES}).`);

    const author = await db.collection('users').doc(authorId).get();
    if (!author.exists) throw new HttpsError('not-found', '등록되지 않은 참가자입니다.');

    // 파일을 GitHub blob 용으로 정리한다. dataUrl(base64) 에서 순수 base64 만 뽑는다.
    let total = 0;
    const cleaned = [];
    let hasEntry = false;
    for (const f of files) {
      const rel = safeRelPath(f.path);
      if (!rel) throw new HttpsError('invalid-argument', `허용되지 않는 파일이 있습니다: ${f.path}`);
      const m = String(f.dataUrl || '').match(/^data:[^;]*;base64,(.*)$/);
      if (!m) throw new HttpsError('invalid-argument', `파일을 읽지 못했습니다: ${f.path}`);
      const b64 = m[1];
      total += Math.floor(b64.length * 0.75);
      if (total > MAX_TOTAL_BYTES) throw new HttpsError('invalid-argument', '파일 합계가 8MB 를 넘습니다.');
      if (rel === 'index.html' || rel.endsWith('/index.html')) hasEntry = true;
      if (rel === 'package.json' || rel.endsWith('/package.json')) hasEntry = true;
      cleaned.push({ rel, b64 });
    }
    if (!hasEntry) throw new HttpsError('invalid-argument', 'index.html 또는 package.json 이 없습니다.');

    const slug = ghSlug(title, authorId);

    // manifest.json 은 폼 값으로 우리가 만든다(수강생이 넣은 건 무시).
    const manifest = {
      title,
      author: author.data().name || authorId,
      authorId,
      cohort: String(meta.cohort || '').trim(),
      description: String(meta.description || '').trim(),
      tags: Array.isArray(meta.tags) ? meta.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6) : [],
      spa: files.some((f) => /(^|\/)(vite\.config|next\.config)\./.test(f.path || '')),
    };

    // ── GitHub: blobs → tree → commit → branch → PR → merge ──────────────
    const base = `/repos/${REPO_OWNER}/${REPO_NAME}`;

    const ref = await gh(token, 'GET', `${base}/git/ref/heads/${REPO_BRANCH}`);
    const baseSha = ref.object.sha;
    const baseCommit = await gh(token, 'GET', `${base}/git/commits/${baseSha}`);

    const tree = [];
    for (const { rel, b64 } of cleaned) {
      const blob = await gh(token, 'POST', `${base}/git/blobs`, { content: b64, encoding: 'base64' });
      tree.push({ path: `apps/${slug}/${rel}`, mode: '100644', type: 'blob', sha: blob.sha });
    }
    // manifest.json 을 텍스트 blob 으로
    const manifestBlob = await gh(token, 'POST', `${base}/git/blobs`, {
      content: JSON.stringify(manifest, null, 2) + '\n',
      encoding: 'utf-8',
    });
    tree.push({ path: `apps/${slug}/manifest.json`, mode: '100644', type: 'blob', sha: manifestBlob.sha });

    const newTree = await gh(token, 'POST', `${base}/git/trees`, {
      base_tree: baseCommit.tree.sha,
      tree,
    });
    const commit = await gh(token, 'POST', `${base}/git/commits`, {
      message: `game: ${title} (${manifest.author})`,
      tree: newTree.sha,
      parents: [baseSha],
    });

    const branch = `submit/${slug}`;
    await gh(token, 'POST', `${base}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });

    const pr = await gh(token, 'POST', `${base}/pulls`, {
      title: `game: ${title} (${manifest.author})`,
      head: branch,
      base: REPO_BRANCH,
      body: `허브 업로드로 자동 생성된 PR 입니다.\n\n- 제작자: ${manifest.author} (\`${authorId}\`)\n- 파일: ${cleaned.length}개\n\n_Generated by [Claude Code](https://claude.ai/code)_`,
    });

    // 자동 머지. 실패해도 PR 은 남기고 사용자에게 알린다.
    let merged = false;
    try {
      await gh(token, 'PUT', `${base}/pulls/${pr.number}/merge`, { merge_method: 'squash' });
      merged = true;
    } catch (err) {
      console.warn('[gamehubSubmit] 자동 머지 실패, PR 은 남김', err.message);
    }

    return { prUrl: pr.html_url, prNumber: pr.number, merged, slug };
  },
);
