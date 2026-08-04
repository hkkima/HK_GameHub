import { firebaseConfig, GAMES_ORIGIN, SITE } from './config.js';
import {
  loginWithPin, loadSession, saveSession, clearSession, LoginError,
} from './auth.js';
import { createAdminPanel } from './admin.js';
import {
  classify, newGameId, publishInstant, publishBundle, deleteInstant, makeThumb, SubmitError,
} from './submit.js';

// 지급 함수(gamehubPayout)가 있는 리전. 로그인은 이제 함수를 쓰지 않지만
// 운영자 지급 호출에는 여전히 필요하다.
const FUNCTIONS_REGION = 'asia-northeast3';

const FIREBASE_VERSION = '10.14.1';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const SDK_TIMEOUT_MS = 12000;

// Firestore 컬렉션 이름.
//
// 이 Firebase 프로젝트는 베팅판·주식판 등 여러 앱과 공유한다. 접두사 없이 users 를
// 쓰면 그쪽 참가자 문서에 좋아요 목록을 덮어쓰게 되므로 반드시 gamehub_ 를 유지할 것.
// firestore.rules 의 경로와 짝을 이룬다.
const GAMES_COL = 'gamehub_games';
const USERS_COL = 'gamehub_users';

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

const state = {
  games: [],          // games.json 그대로
  likeCounts: {},     // slug -> number
  myLikes: new Set(), // 내가 좋아요한 slug
  user: null,         // { userId, name } - 학급 참가자. 익명 uid 가 아니다.
  sort: 'new',
  query: '',
  tag: null,
  pending: new Set(), // 좋아요 전송 중인 slug
};

// Firebase SDK 가 로드된 뒤에만 채워진다. null 이면 로그인과 좋아요가 비활성.
//
// 초기화는 페이지 로드 직후 시작하지만 몇백 ms 걸린다. 그 사이에 로그인 버튼을
// 누르면 아직 준비가 안 된 상태인데, 그렇다고 "사용할 수 없습니다" 를 띄우면
// 정상 환경에서도 로드 직후에는 로그인이 안 되는 것처럼 보인다.
// 그래서 준비 상태를 프로미스로 들고 있다가 필요한 시점에 기다린다.
let fb = null;
let fbPromise = null;

function ensureFirebase() {
  if (!fbPromise) {
    fbPromise = initFirebase().then((v) => { fb = v; return v; });
  }
  return fbPromise;
}

const $ = (sel) => document.querySelector(sel);
const el = {
  grid: $('#grid'),
  skeleton: $('#skeleton'),
  empty: $('#empty'),
  tagbar: $('#tagbar'),
  search: $('#search'),
  countLine: $('#count-line'),
  authAnon: $('#auth-anon'),
  authUser: $('#auth-user'),
  userName: $('#user-name'),
  userBadge: $('#user-badge'),
  loginBtn: $('#btn-login'),
  dialog: $('#login-dialog'),
  loginForm: $('#login-form'),
  loginName: $('#login-name'),
  loginPin: $('#login-pin'),
  loginError: $('#login-error'),
  loginSubmit: $('#login-submit'),
  player: $('#player'),
  frame: $('#game-frame'),
  playerTitle: $('#player-title'),
  playerAuthor: $('#player-author'),
  playerLike: $('#player-like'),
  playerLikeCount: $('#player-like-count'),
  newtab: $('#btn-newtab'),
  toast: $('#toast'),
  adminPanel: $('#admin-panel'),
  uploadBtn: $('#btn-upload'),
  uploadDialog: $('#upload-dialog'),
  uploadForm: $('#upload-form'),
  uploadWho: $('#upload-who'),
  upTitle: $('#up-title'),
  upTags: $('#up-tags'),
  upDesc: $('#up-desc'),
  upFiles: $('#up-files'),
  dropzone: $('#dropzone'),
  upPicked: $('#up-picked'),
  upThumb: $('#up-thumb'),
  upThumbBtn: $('#up-thumb-btn'),
  upThumbPreview: $('#up-thumb-preview'),
  upThumbClear: $('#up-thumb-clear'),
  uploadMsg: $('#upload-msg'),
  uploadSubmit: $('#upload-submit'),
};

// ---------------------------------------------------------------------------
// 오리진 격리 점검
//
// 게임은 수강생이 만든 신뢰할 수 없는 코드다. 허브와 같은 오리진에서 돌면
// allow-same-origin 이 붙는 순간 IndexedDB 의 인증 토큰을 읽을 수 있다.
// 오리진이 다를 때만 allow-same-origin 을 준다(게임의 localStorage 저장 기능용).
// ---------------------------------------------------------------------------

const gamesOrigin = new URL(GAMES_ORIGIN, location.href).origin;
const isolated = gamesOrigin !== location.origin;

if (!isolated) {
  console.warn(
    '[HK GameHub] 게임이 허브와 같은 오리진에서 서빙되고 있습니다. ' +
    '게임 코드가 로그인 정보에 접근하지 못하도록 allow-same-origin 을 제거합니다. ' +
    '(게임 내 localStorage 저장 기능이 동작하지 않을 수 있습니다)'
  );
}

const SANDBOX = [
  'allow-scripts',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-pointer-lock',
  'allow-modals',
  ...(isolated ? ['allow-same-origin'] : []),
].join(' ');

// 즉시 게시 게임은 srcdoc 으로 렌더한다. srcdoc 은 부모(허브) 오리진을 물려받으므로
// allow-same-origin 을 절대 주면 안 된다 — 주는 순간 게임이 허브 오리진에서 돌며
// 로그인 정보에 접근할 수 있다. same-origin 없이 두면 오리진이 없는 샌드박스라
// 완전히 격리되고, 대신 localStorage 같은 저장 기능은 쓸 수 없다.
const SANDBOX_SRCDOC = [
  'allow-scripts',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-pointer-lock',
  'allow-modals',
].join(' ');

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2800);
}

function gameUrl(slug) {
  return `${GAMES_ORIGIN.replace(/\/$/, '')}/g/${encodeURIComponent(slug)}/`;
}

// 제목 첫 글자로 만드는 썸네일 대체 이미지. slug 해시로 색을 고정한다.
function fallbackThumb(game) {
  let h = 0;
  for (const ch of game.slug) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const bg = `linear-gradient(135deg, hsl(${h} 58% 32%), hsl(${(h + 48) % 360} 58% 22%))`;
  return `<div class="fallback" style="background:${bg}">${esc([...game.title][0] || '?')}</div>`;
}

// ---------------------------------------------------------------------------
// Firebase
//
// 동적 import 로 불러온다. gstatic 에 닿지 못하거나 config 가 비어 있어도
// 갤러리와 플레이는 그대로 동작해야 하기 때문이다. 로그인과 좋아요만 꺼진다.
// ---------------------------------------------------------------------------

async function initFirebase() {
  if (String(firebaseConfig.apiKey).startsWith('TODO_')) {
    console.warn('[HK GameHub] hub/config.js 의 firebaseConfig 가 아직 채워지지 않았습니다. 로그인과 좋아요가 비활성화됩니다.');
    return null;
  }

  let appMod, authMod, fsMod, fnsMod;
  try {
    // 방화벽이나 DNS 블랙홀 뒤에서는 요청이 거부되지 않고 그대로 매달린다.
    // 타임아웃이 없으면 로그인 버튼이 영원히 활성 상태로 남는다.
    [appMod, authMod, fsMod, fnsMod] = await Promise.race([
      Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-auth.js`),
        import(`${CDN}/firebase-firestore.js`),
        import(`${CDN}/firebase-functions.js`),
      ]),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`Firebase SDK 로드가 ${SDK_TIMEOUT_MS}ms 안에 끝나지 않았습니다`)),
        SDK_TIMEOUT_MS,
      )),
    ]);
  } catch (err) {
    console.error('[HK GameHub] Firebase SDK 를 불러오지 못했습니다. 로그인과 좋아요만 비활성화되고 나머지는 정상 동작합니다.', err);
    return null;
  }

  try {
    const app = appMod.initializeApp(firebaseConfig);
    return {
      auth: authMod.getAuth(app),
      db: fsMod.getFirestore(app),
      functions: fnsMod.getFunctions(app, FUNCTIONS_REGION),
      auths: authMod,
      fs: fsMod,
      fns: fnsMod,
    };
  } catch (err) {
    console.error('[HK GameHub] Firebase 초기화에 실패했습니다.', err);
    return null;
  }
}

function disableAuthUi(reason) {
  el.loginBtn.disabled = true;
  el.loginBtn.title = reason;
  el.loginBtn.textContent = '로그인 불가';
}

// ---------------------------------------------------------------------------
// 렌더
// ---------------------------------------------------------------------------

function visibleGames() {
  const q = state.query.trim().toLowerCase();

  const list = state.games.filter((g) => {
    if (state.tag && !(g.tags || []).includes(state.tag)) return false;
    if (!q) return true;
    const hay = [g.title, g.author, g.cohort, g.description, ...(g.tags || [])]
      .join(' ').toLowerCase();
    return hay.includes(q);
  });

  const likes = (g) => state.likeCounts[g.slug] || 0;

  list.sort((a, b) => {
    if (state.sort === 'likes') return likes(b) - likes(a) || a.title.localeCompare(b.title, 'ko');
    if (state.sort === 'title') return a.title.localeCompare(b.title, 'ko');
    return (b.addedAt || '').localeCompare(a.addedAt || '') || a.title.localeCompare(b.title, 'ko');
  });

  return list;
}

function cardHtml(g) {
  const count = state.likeCounts[g.slug] || 0;
  const liked = state.myLikes.has(g.slug);
  // 즉시 게시 게임의 thumb 는 data URI(그대로 쓴다). Cloudflare 게임은 게임 폴더
  // 안의 파일 경로라 게임 오리진 URL 을 앞에 붙인다.
  const thumbSrc = g.thumb ? (g.instant ? g.thumb : gameUrl(g.slug) + g.thumb) : null;
  const thumb = thumbSrc
    ? `<img src="${esc(thumbSrc)}" alt="" loading="lazy">`
    : fallbackThumb(g);

  const tags = (g.tags || []).slice(0, 3)
    .map((t) => `<button class="tag${state.tag === t ? ' is-on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`)
    .join('');

  // 내가(로그인한 참가자가) 올린 즉시 게시 게임에만 수정·삭제 버튼을 보인다.
  // 소유 판정은 participantId(authorId) 기준이라 기기·재로그인과 무관하다.
  const owned = g.instant && state.user && g.authorId && g.authorId === state.user.userId;
  const ownerTools = owned
    ? `<div class="card-owner">
         <button class="linkish" data-edit="${esc(g.slug)}">수정</button>
         <button class="linkish" data-del="${esc(g.slug)}">삭제</button>
       </div>`
    : '';

  return `
    <article class="card" data-slug="${esc(g.slug)}">
      <div class="card-thumb" data-play="${esc(g.slug)}" role="button" tabindex="0" aria-label="${esc(g.title)} 플레이">
        ${thumb}
        <div class="play-veil"><span>▶ 플레이</span></div>
        ${ownerTools}
      </div>
      <div class="card-body">
        <h3 class="card-title" data-play="${esc(g.slug)}">${esc(g.title)}</h3>
        ${g.description ? `<p class="card-desc">${esc(g.description)}</p>` : ''}
        ${tags ? `<div class="card-tags">${tags}</div>` : ''}
        <div class="card-foot">
          <span class="card-author">${esc(g.author)}${g.cohort ? ` <span class="card-cohort">· ${esc(g.cohort)}</span>` : ''}</span>
          <button class="btn-like" data-like="${esc(g.slug)}" aria-pressed="${liked}" aria-label="좋아요">
            <svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5l-1.4-1.3C5.4 14.5 2 11.4 2 7.6 2 4.9 4.1 3 6.7 3c1.5 0 3 .7 3.9 1.9L12 6l1.4-1.1C14.3 3.7 15.8 3 17.3 3 19.9 3 22 4.9 22 7.6c0 3.8-3.4 6.9-8.6 11.6z"/></svg>
            <span data-count="${esc(g.slug)}">${count}</span>
          </button>
        </div>
      </div>
    </article>`;
}

function render() {
  const list = visibleGames();
  el.grid.innerHTML = list.map(cardHtml).join('');
  el.empty.hidden = list.length > 0;
  el.countLine.textContent = `게임 ${state.games.length}개`;
}

function renderTagbar() {
  const freq = new Map();
  for (const g of state.games) for (const t of g.tags || []) freq.set(t, (freq.get(t) || 0) + 1);

  const tags = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  if (!tags.length) { el.tagbar.innerHTML = ''; return; }

  el.tagbar.innerHTML = `<button class="chip${state.tag ? '' : ' is-on'}" data-tag="">전체</button>` +
    tags.map(([t, n]) => `<button class="chip${state.tag === t ? ' is-on' : ''}" data-tag="${esc(t)}">${esc(t)} <span style="opacity:.55">${n}</span></button>`).join('');
}

// 좋아요 UI 만 부분 갱신한다. 전체 리렌더는 열려 있는 iframe 을 날려버린다.
function paintLike(slug) {
  const count = state.likeCounts[slug] || 0;
  const liked = state.myLikes.has(slug);
  const busy = state.pending.has(slug);

  document.querySelectorAll(`[data-count="${CSS.escape(slug)}"]`).forEach((n) => { n.textContent = count; });
  document.querySelectorAll(`[data-like="${CSS.escape(slug)}"]`).forEach((n) => {
    n.setAttribute('aria-pressed', String(liked));
    n.disabled = busy;
  });

  if (el.player.dataset.slug === slug) {
    el.playerLikeCount.textContent = count;
    el.playerLike.setAttribute('aria-pressed', String(liked));
    el.playerLike.disabled = busy;
  }
}

function paintAllLikes() {
  for (const g of state.games) paintLike(g.slug);
}

function paintAuth() {
  const u = state.user;
  el.authAnon.hidden = !!u;
  el.authUser.hidden = !u;
  el.uploadBtn.hidden = !u; // 로그인해야 게임을 올릴 수 있다
  if (u) {
    el.userName.textContent = u.name;
    el.userBadge.textContent = [...u.name][0] || '?';
  }
}

// ---------------------------------------------------------------------------
// 데이터 로드
// ---------------------------------------------------------------------------

// 갤러리는 두 소스를 합친다.
//   - games.json      : PR·빌드를 거쳐 Cloudflare 에 올라간 게임(멀티파일 포함)
//   - gamehub_instant : 수강생이 바로 올린 단일 HTML(검토·빌드 없음)
// slug 는 두 소스에 걸쳐 유일하다. instant 게임은 instant:true 로 표시한다.
let cloudflareGames = [];

async function loadGames() {
  const res = await fetch('./games.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`games.json ${res.status}`);
  const data = await res.json();
  cloudflareGames = Array.isArray(data) ? data : (data.games || []);
  mergeGames([]);
}

function mergeGames(instant) {
  // instant 가 같은 slug 를 가지면 games.json 쪽을 우선한다(정식 배포가 이김).
  const seen = new Set(cloudflareGames.map((g) => g.slug));
  const extra = instant.filter((g) => !seen.has(g.slug));
  state.games = [...cloudflareGames, ...extra];
}

// 즉시 게시 게임의 메타만 읽는다(HTML 은 플레이할 때 별도로 읽는다).
async function loadInstant() {
  if (!fb) return;
  const { collection, getDocs } = fb.fs;
  const snap = await getDocs(collection(fb.db, 'gamehub_instant'));
  const list = [];
  snap.forEach((d) => {
    const m = d.data();
    list.push({
      slug: d.id,
      title: m.title,
      author: m.author,
      authorId: m.authorId || '',
      cohort: m.cohort || '',
      description: m.description || '',
      tags: m.tags || [],
      thumb: m.thumb || '',
      addedAt: m.createdAt?.toDate?.().toISOString?.() || '',
      instant: true,
      by: m.by || '',
    });
  });
  mergeGames(list);
}

// 게임 문서 전체를 한 번에 읽는다. 좋아요가 한 번도 없는 게임은 문서가 없어서
// 결과에서 빠지고, 그 경우 카운트는 0 으로 취급된다.
async function loadLikeCounts() {
  if (!fb) return;
  const { collection, getDocs } = fb.fs;
  const snap = await getDocs(collection(fb.db, GAMES_COL));
  const counts = {};
  snap.forEach((d) => { counts[d.id] = d.data().likeCount || 0; });
  state.likeCounts = counts;
}

// 내 좋아요 목록은 문서 하나로 끝낸다 (게임 수만큼 읽지 않기 위함)
async function loadMyLikes(userId) {
  if (!fb || !userId) { state.myLikes = new Set(); return; }
  const { doc, getDoc } = fb.fs;
  const snap = await getDoc(doc(fb.db, USERS_COL, userId));
  state.myLikes = new Set(snap.exists() ? (snap.data().liked || []) : []);
}

// ---------------------------------------------------------------------------
// 좋아요 토글
//
// 세 문서를 하나의 배치로 원자적으로 쓴다.
//   gamehub_games/{slug}                  likeCount, lastBy
//   gamehub_games/{slug}/likes/{userId}   문서 존재 = 좋아요
//   gamehub_users/{userId}                liked 배열 (UI 캐시)
//
// 보안 규칙이 lastBy 로 지목된 참가자의 좋아요 문서가 실제로 생겼는지(사라졌는지)
// getAfter() 로 대조하므로, 좋아요 문서 없이 숫자만 올릴 수 없다. 좋아요 문서는
// 참가자당 하나뿐이라 한 게임의 카운트는 등록된 참가자 수를 넘을 수 없다.
// ---------------------------------------------------------------------------

async function toggleLike(slug) {
  if (!state.user) { openLogin(); return; }
  if (state.pending.has(slug)) return;

  if (!await ensureFirebase()) {
    toast('좋아요 기능을 사용할 수 없습니다. 잠시 후 새로고침해 주세요.');
    return;
  }

  const { doc, writeBatch, increment, serverTimestamp, arrayUnion, arrayRemove } = fb.fs;
  const userId = state.user.userId;
  const liked = state.myLikes.has(slug);
  const delta = liked ? -1 : 1;

  // 낙관적 갱신
  state.pending.add(slug);
  if (liked) state.myLikes.delete(slug); else state.myLikes.add(slug);
  state.likeCounts[slug] = Math.max(0, (state.likeCounts[slug] || 0) + delta);
  paintLike(slug);

  if (!liked) {
    document.querySelectorAll(`[data-like="${CSS.escape(slug)}"]`).forEach((n) => {
      n.classList.remove('pulse');
      void n.offsetWidth;
      n.classList.add('pulse');
    });
  }

  const batch = writeBatch(fb.db);
  const gameRef = doc(fb.db, GAMES_COL, slug);
  const likeRef = doc(fb.db, GAMES_COL, slug, 'likes', userId);
  const userRef = doc(fb.db, USERS_COL, userId);

  // lastBy 로 이번에 누른 참가자를 지목한다. 규칙이 이 참가자의 좋아요 문서가
  // 실제로 생겼는지(사라졌는지)를 getAfter() 로 대조한다.
  batch.set(gameRef, { likeCount: increment(delta), lastBy: userId }, { merge: true });
  if (liked) batch.delete(likeRef);
  // paidIn 은 지급 회차 ID. 아직 미지급이라 null 로 두고, gamehubPayout 이 채운다.
  // 이 필드가 있어야 함수가 미지급 좋아요만 골라낼 수 있다.
  else batch.set(likeRef, { createdAt: serverTimestamp(), paidIn: null });
  batch.set(userRef, { liked: liked ? arrayRemove(slug) : arrayUnion(slug) }, { merge: true });

  try {
    await batch.commit();
  } catch (err) {
    // 롤백
    if (liked) state.myLikes.add(slug); else state.myLikes.delete(slug);
    state.likeCounts[slug] = Math.max(0, (state.likeCounts[slug] || 0) - delta);
    console.error('[HK GameHub] 좋아요 저장 실패', err);
    toast('좋아요를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    state.pending.delete(slug);
    paintLike(slug);
  }
}

// ---------------------------------------------------------------------------
// 플레이어
// ---------------------------------------------------------------------------

async function openGame(slug) {
  const g = state.games.find((x) => x.slug === slug);
  if (!g) return;

  el.player.dataset.slug = slug;
  el.playerTitle.textContent = g.title;
  el.playerAuthor.textContent = [g.author, g.cohort].filter(Boolean).join(' · ');

  if (g.instant) {
    // 즉시 게시 게임: HTML 을 읽어 srcdoc 으로 렌더한다(오리진 없는 샌드박스).
    el.newtab.href = '';
    el.newtab.style.display = 'none';
    el.frame.removeAttribute('src');
    el.frame.setAttribute('sandbox', SANDBOX_SRCDOC);
    el.frame.srcdoc = '<!doctype html><body style="margin:0;background:#000">';
    try {
      const { doc, getDoc } = fb.fs;
      const snap = await getDoc(doc(fb.db, 'gamehub_instant', slug, 'content', 'html'));
      // 그 사이 다른 게임을 열었으면 무시
      if (el.player.dataset.slug !== slug) return;
      el.frame.srcdoc = snap.exists() ? (snap.data().html || '') : '<!doctype html><p>게임을 불러오지 못했습니다.';
    } catch (err) {
      console.error('[HK GameHub] 즉시 게시 게임 로드 실패', err);
      el.frame.srcdoc = '<!doctype html><p style="font-family:sans-serif;padding:20px">게임을 불러오지 못했습니다.';
    }
  } else {
    el.newtab.href = gameUrl(slug);
    el.newtab.style.display = '';
    el.frame.removeAttribute('srcdoc');
    el.frame.setAttribute('sandbox', SANDBOX);
    el.frame.src = gameUrl(slug);
  }

  el.player.hidden = false;
  document.body.style.overflow = 'hidden';
  paintLike(slug);

  if (location.hash !== `#play/${slug}`) history.pushState({ slug }, '', `#play/${slug}`);
}

function closeGame({ back = true } = {}) {
  if (el.player.hidden) return;
  el.player.hidden = true;
  el.frame.removeAttribute('src');    // 게임 즉시 정지
  el.frame.removeAttribute('srcdoc');
  delete el.player.dataset.slug;
  document.body.style.overflow = '';
  if (back && location.hash.startsWith('#play/')) history.pushState({}, '', location.pathname);
}

function syncFromHash() {
  const m = location.hash.match(/^#play\/(.+)$/);
  if (m) openGame(decodeURIComponent(m[1]));
  else closeGame({ back: false });
}

// ---------------------------------------------------------------------------
// 로그인
// ---------------------------------------------------------------------------

function openLogin() {
  // Firebase 준비 여부와 무관하게 창은 바로 연다. 준비는 제출할 때 기다린다.
  el.loginError.hidden = true;
  el.dialog.showModal();
  el.loginName.focus();
}

async function submitLogin(event) {
  event.preventDefault();

  el.loginError.hidden = true;
  el.loginSubmit.disabled = true;
  el.loginSubmit.textContent = '확인 중…';

  try {
    if (!await ensureFirebase()) {
      throw new LoginError('지금은 로그인할 수 없습니다. 잠시 후 새로고침해 주세요.');
    }
    const session = await loginWithPin(fb, el.loginName.value, el.loginPin.value);
    saveSession(session);
    state.user = session;
    paintAuth();

    el.dialog.close();
    el.loginForm.reset();

    await loadMyLikes(session.userId);
    paintAllLikes();
    toast(`${session.name} 님, 반갑습니다.`);
  } catch (err) {
    el.loginError.textContent = err instanceof LoginError
      ? err.message
      : '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    el.loginError.hidden = false;
    if (!(err instanceof LoginError)) console.error('[HK GameHub] 로그인 실패', err);
  } finally {
    el.loginSubmit.disabled = false;
    el.loginSubmit.textContent = '로그인';
  }
}

// ---------------------------------------------------------------------------
// 게임 올리기
// ---------------------------------------------------------------------------

let picked = null;    // classify() 결과
let thumbUri = null;  // makeThumb() 결과 data URI
let editing = null;   // 수정 중인 게임 { slug, ... } 또는 null(신규)

function resetUpload() {
  el.uploadForm.reset();
  picked = null;
  thumbUri = null;
  editing = null;
  el.upPicked.hidden = true;
  el.upPicked.className = 'up-picked';
  el.upThumbPreview.hidden = true;
  el.upThumbPreview.removeAttribute('src');
  el.upThumbClear.hidden = true;
  el.uploadMsg.hidden = true;
  el.dropzone.classList.remove('drag');
}

async function handleThumb(file) {
  el.uploadMsg.hidden = true;
  try {
    thumbUri = await makeThumb(file);
    el.upThumbPreview.src = thumbUri;
    el.upThumbPreview.hidden = false;
    el.upThumbClear.hidden = false;
  } catch (err) {
    thumbUri = null;
    el.uploadMsg.textContent = err instanceof SubmitError ? err.message : '썸네일을 처리하지 못했습니다.';
    el.uploadMsg.hidden = false;
  }
}

function clearThumb() {
  thumbUri = null;
  el.upThumb.value = '';
  el.upThumbPreview.hidden = true;
  el.upThumbPreview.removeAttribute('src');
  el.upThumbClear.hidden = true;
}

// game 을 주면 수정 모드로 연다. 안 주면 새 게임.
function openUpload(game = null) {
  if (!state.user) { openLogin(); return; }
  resetUpload();

  if (game) {
    editing = game;
    el.upTitle.value = game.title || '';
    el.upTags.value = (game.tags || []).join(', ');
    el.upDesc.value = game.description || '';
    if (game.thumb) {
      thumbUri = game.thumb;
      el.upThumbPreview.src = game.thumb;
      el.upThumbPreview.hidden = false;
      el.upThumbClear.hidden = false;
    }
    el.uploadWho.textContent = '수정 중 — 파일을 새로 고르지 않으면 기존 게임이 그대로 유지됩니다.';
    el.uploadSubmit.textContent = '수정';
  } else {
    el.uploadWho.textContent = `${state.user.name} 님의 게임으로 올라갑니다.`;
    el.uploadSubmit.textContent = '게시';
  }

  el.uploadDialog.showModal();
  el.upTitle.focus();
}

async function deleteGame(slug) {
  const g = state.games.find((x) => x.slug === slug);
  if (!g) return;
  if (!g.instant || g.authorId !== state.user?.userId) { toast('삭제 권한이 없습니다.'); return; }
  if (!confirm(`"${g.title}" 를 삭제할까요? 되돌릴 수 없습니다.`)) return;
  try {
    if (!await ensureFirebase()) throw new Error('unavailable');
    await deleteInstant(fb, slug);
    toast('삭제되었습니다.');
    await loadInstant();
    renderTagbar();
    render();
  } catch (err) {
    console.error('[HK GameHub] 삭제 실패', err);
    toast('삭제하지 못했습니다.');
  }
}

async function handleFiles(fileList) {
  el.uploadMsg.hidden = true;
  picked = null;
  el.upPicked.className = 'up-picked';
  try {
    picked = await classify(fileList);
    if (picked.kind === 'instant') {
      el.upPicked.textContent = '단일 HTML — 게시하면 바로 갤러리에 올라갑니다.';
      el.upPicked.classList.add('instant');
    } else {
      el.upPicked.textContent = `여러 파일(${picked.files.length}개) — 빌드를 거쳐 잠시 뒤 올라갑니다.`;
      el.upPicked.classList.add('bundle');
    }
    el.upPicked.hidden = false;
  } catch (err) {
    if (err instanceof SubmitError) {
      el.uploadMsg.textContent = err.message;
      el.uploadMsg.hidden = false;
    } else {
      console.error('[HK GameHub] 파일 분류 실패', err);
      el.uploadMsg.textContent = '파일을 읽지 못했습니다.';
      el.uploadMsg.hidden = false;
    }
    el.upPicked.hidden = true;
  }
}

async function submitUpload(event) {
  event.preventDefault();
  el.uploadMsg.hidden = true;

  const title = el.upTitle.value.trim();
  if (!title) { el.uploadMsg.textContent = '제목을 입력하세요.'; el.uploadMsg.hidden = false; return; }
  if (!state.user) { openLogin(); return; }
  // 신규는 파일 필수. 수정은 파일을 안 고르면 기존 게임을 유지한다.
  if (!picked && !editing) { el.uploadMsg.textContent = '게임 파일을 선택하세요.'; el.uploadMsg.hidden = false; return; }
  // 멀티파일 게임은 즉시 게시(수정) 대상이 아니다. 수정 버튼은 즉시 게시 게임에만 뜬다.
  if (editing && picked && picked.kind === 'bundle') {
    el.uploadMsg.textContent = '여러 파일 게임은 이 화면에서 수정할 수 없습니다. 새로 올려 주세요.';
    el.uploadMsg.hidden = false;
    return;
  }

  const meta = {
    title,
    author: state.user.name,
    authorId: state.user.userId,
    cohort: '',
    description: el.upDesc.value.trim(),
    tags: el.upTags.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6),
    thumb: thumbUri || '',
  };
  const isBundle = picked && picked.kind === 'bundle';
  const label = editing ? '수정' : (isBundle ? '올리기' : '게시');

  el.uploadSubmit.disabled = true;
  el.uploadSubmit.textContent = `${label} 중…`;

  try {
    if (!await ensureFirebase()) throw new SubmitError('지금은 올릴 수 없습니다. 잠시 후 다시 시도해 주세요.');

    if (isBundle) {
      // 멀티파일: 함수가 GitHub PR 을 만들고 자동 머지한다. 빌드를 거쳐 배포되므로
      // 갤러리에 뜨기까지 몇 분 걸린다(즉시 게시가 아니다).
      const res = await publishBundle(fb, { meta, files: picked.files });
      el.uploadDialog.close();
      toast(res.merged
        ? '올렸습니다. 빌드를 거쳐 몇 분 뒤 갤러리에 올라옵니다.'
        : '올렸습니다. 자동 반영에 실패해 검토 후 반영됩니다.');
    } else {
      await publishInstant(fb, {
        slug: editing ? editing.slug : newGameId(),
        meta,
        html: picked ? picked.html : null, // 수정 시 파일 미교체면 기존 유지
        uid: fb.auth.currentUser.uid,
      });
      el.uploadDialog.close();
      toast(editing ? '수정되었습니다.' : '게시되었습니다. 갤러리에 올라갔어요.');
      await loadInstant();
      renderTagbar();
      render();
    }
  } catch (err) {
    el.uploadMsg.textContent = err instanceof SubmitError
      ? err.message
      : mapFunctionError(err) || `${label}하지 못했습니다. 잠시 후 다시 시도해 주세요.`;
    el.uploadMsg.hidden = false;
    if (!(err instanceof SubmitError)) console.error('[HK GameHub] 업로드 실패', err);
  } finally {
    el.uploadSubmit.disabled = false;
    el.uploadSubmit.textContent = label;
  }
}

// gamehubSubmit 함수가 던지는 HttpsError 는 사용자에게 보여줄 만한 문구다.
function mapFunctionError(err) {
  const code = err?.code || '';
  if (code.startsWith('functions/')) return err.message;
  return null;
}

async function logout() {
  clearSession();
  state.user = null;
  state.myLikes = new Set();
  paintAuth();
  paintAllLikes();
  if (fb) { try { await fb.auths.signOut(fb.auth); } catch { /* 무시 */ } }
}

// ---------------------------------------------------------------------------
// 운영자
//
// 강사만 Google 로 로그인한다. 수강생 로그인(커스텀 토큰)과 같은 Firebase Auth 를
// 쓰므로 둘은 공존할 수 없다. 운영자로 들어오면 수강생 세션은 정리한다.
// ---------------------------------------------------------------------------

let adminPanel = null;

async function adminLogin() {
  if (!await ensureFirebase()) { toast('지금은 사용할 수 없습니다.'); return; }
  try {
    await fb.auths.signInWithPopup(fb.auth, new fb.auths.GoogleAuthProvider());
  } catch (err) {
    if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') return;
    console.error('[HK GameHub] 운영자 로그인 실패', err);
    toast(err?.code === 'auth/unauthorized-domain'
      ? 'Firebase 승인된 도메인에 이 주소를 추가해야 합니다.'
      : '운영자 로그인에 실패했습니다.');
  }
}

async function adminLogout() {
  if (fb) { try { await fb.auths.signOut(fb.auth); } catch { /* 무시 */ } }
  showAdmin(false);
}

function showAdmin(on) {
  el.adminPanel.hidden = !on;
  $('#btn-admin').hidden = on;
  $('#btn-admin-out').hidden = !on;
}

// 수강생(익명)과 운영자(Google)가 같은 Firebase Auth 를 공유하므로 관찰자 하나로
// 둘 다 처리한다. 익명 uid 는 학급 신원이 아니므로, 수강생 신원은 localStorage
// 세션(participantId)에서 가져온다. Firebase 가 익명 로그인을 유지하므로 새로고침
// 해도 PIN 을 다시 묻지 않는다.
function watchAuth() {
  fb.auths.onAuthStateChanged(fb.auth, async (user) => {
    const isGoogle = !!user?.providerData?.some((p) => p.providerId === 'google.com');

    if (isGoogle) {
      // 운영자로 들어왔으면 수강생 세션은 정리한다
      clearSession();
      state.user = null;
      state.myLikes = new Set();
      paintAuth();
      paintAllLikes();

      showAdmin(true);
      if (!adminPanel) {
        adminPanel = createAdminPanel({ fb, root: el.adminPanel, onToast: toast });
      }
      adminPanel.refresh();
      return;
    }

    showAdmin(false);

    // 익명 로그인 + 저장된 세션이 함께 있어야 로그인 상태로 본다.
    const session = user ? loadSession() : null;
    state.user = session;
    paintAuth();
    // 로그인 상태에 따라 내 게임의 수정·삭제 버튼 노출이 달라지므로 카드를 다시 그린다.
    // (플레이어가 열려 있어도 갤러리 그리드는 별개라 안전하다.)
    render();

    if (!session) {
      state.myLikes = new Set();
      paintAllLikes();
      return;
    }

    try {
      await loadMyLikes(session.userId);
    } catch (err) {
      console.warn('[HK GameHub] 좋아요 목록을 불러오지 못했습니다', err);
    }
    paintAllLikes();
  });
}

// ---------------------------------------------------------------------------
// 이벤트
// ---------------------------------------------------------------------------

function setTag(tag) {
  state.tag = state.tag === tag ? null : tag;
  renderTagbar();
  render();
}

el.grid.addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    e.stopPropagation();
    const g = state.games.find((x) => x.slug === edit.dataset.edit);
    if (g) openUpload(g);
    return;
  }

  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); deleteGame(del.dataset.del); return; }

  const like = e.target.closest('[data-like]');
  if (like) { toggleLike(like.dataset.like); return; }

  const tag = e.target.closest('[data-tag]');
  if (tag) { setTag(tag.dataset.tag || null); return; }

  const play = e.target.closest('[data-play]');
  if (play) openGame(play.dataset.play);
});

el.grid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const play = e.target.closest('[data-play]');
  if (play) { e.preventDefault(); openGame(play.dataset.play); }
});

el.tagbar.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tag]');
  if (btn) setTag(btn.dataset.tag || null);
});

document.querySelectorAll('[data-sort]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.sort = btn.dataset.sort;
    document.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('is-on', b === btn));
    render();
  });
});

let searchTimer;
el.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = el.search.value; render(); }, 120);
});

$('#btn-close').addEventListener('click', () => closeGame());

el.playerLike.addEventListener('click', () => {
  const slug = el.player.dataset.slug;
  if (slug) toggleLike(slug);
});

document.addEventListener('keydown', (e) => {
  // 로그인 창이 떠 있으면 ESC 는 그쪽이 가져간다
  if (e.key === 'Escape' && !el.dialog.open) closeGame();
});

window.addEventListener('popstate', syncFromHash);

el.loginBtn.addEventListener('click', openLogin);
el.loginForm.addEventListener('submit', submitLogin);
$('#login-cancel').addEventListener('click', () => el.dialog.close());
$('#btn-logout').addEventListener('click', logout);
$('#btn-admin').addEventListener('click', adminLogin);
$('#btn-admin-out').addEventListener('click', adminLogout);

// 업로드
// 화살표로 감싼다. 직접 넘기면 클릭 이벤트 객체가 openUpload(game) 의 game 으로
// 들어가(truthy) 신규인데도 수정 모드로 열린다.
el.uploadBtn.addEventListener('click', () => openUpload());
el.uploadForm.addEventListener('submit', submitUpload);
$('#upload-cancel').addEventListener('click', () => el.uploadDialog.close());
el.dropzone.addEventListener('click', () => el.upFiles.click());
el.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.upFiles.click(); }
});
el.upFiles.addEventListener('change', () => { if (el.upFiles.files.length) handleFiles(el.upFiles.files); });
el.upThumbBtn.addEventListener('click', () => el.upThumb.click());
el.upThumb.addEventListener('change', () => { if (el.upThumb.files[0]) handleThumb(el.upThumb.files[0]); });
el.upThumbClear.addEventListener('click', clearThumb);
['dragenter', 'dragover'].forEach((ev) => el.dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); el.dropzone.classList.add('drag');
}));
['dragleave', 'drop'].forEach((ev) => el.dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); el.dropzone.classList.remove('drag');
}));
el.dropzone.addEventListener('drop', (e) => {
  const files = e.dataTransfer?.files;
  if (files && files.length) handleFiles(files);
});

// ---------------------------------------------------------------------------
// 시작
//
// 갤러리는 Firebase 와 무관하게 먼저 뜬다. 좋아요 수와 로그인 상태는
// SDK 가 준비되는 대로 뒤늦게 얹힌다.
// ---------------------------------------------------------------------------

$('#site-title').textContent = SITE.title;
$('#site-tagline').textContent = SITE.tagline;
document.title = SITE.title;

(async function boot() {
  try {
    await loadGames();
  } catch (err) {
    console.error('[HK GameHub] games.json 을 불러오지 못했습니다', err);
    el.skeleton.remove();
    el.empty.textContent = 'games.json 을 불러오지 못했습니다. 빌드가 정상적으로 끝났는지 확인해 주세요.';
    el.empty.hidden = false;
    return;
  }

  el.skeleton.remove();
  renderTagbar();
  render();
  syncFromHash();

  if (!await ensureFirebase()) {
    disableAuthUi('Firebase 를 사용할 수 없어 로그인과 좋아요가 비활성화되었습니다.');
    return;
  }

  watchAuth();

  // 즉시 게시 게임을 갤러리에 합친다.
  try {
    await loadInstant();
    renderTagbar();
    render();
    syncFromHash();
  } catch (err) {
    console.warn('[HK GameHub] 즉시 게시 게임을 불러오지 못했습니다', err);
  }

  try {
    await loadLikeCounts();
  } catch (err) {
    // 좋아요 수를 못 읽어도 갤러리와 플레이는 그대로 동작한다
    console.warn('[HK GameHub] 좋아요 수를 불러오지 못했습니다', err);
  }

  paintAllLikes();
})();
