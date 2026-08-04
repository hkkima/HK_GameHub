// 게임 올리기
//
// 두 갈래로 나뉜다.
//   - 자체완결 index.html 하나       → Firestore 에 즉시 게시 (검토·빌드 없음)
//   - 여러 파일 / package.json 있음   → gamehubSubmit 함수가 PR 생성·자동머지
//
// "자체완결" 은 외부 파일(로컬 src/href)을 참조하지 않는 단일 HTML 을 말한다.
// 이미지·스크립트가 별도 파일로 분리돼 있으면 즉시 게시로는 상대경로가 깨지므로
// 멀티파일 경로로 보낸다.

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;
const INSTANT_MAX = 900000;   // Firestore 문서 여유 한도
const BUNDLE_MAX = 8 * 1024 * 1024; // 함수로 보낼 멀티파일 합계 상한

export class SubmitError extends Error {}

// 즉시 게시 게임의 문서 ID. Firestore ID 는 유니코드를 허용하므로 한글 제목을
// 그대로 살린다(URL 해시에서는 encodeURIComponent 로 처리된다). 금지 문자만 제거.
// 같은 제목을 다시 올리면 같은 slug 가 되어 "수정" 이 된다.
export function toSlug(title, authorId) {
  const base = String(title).trim().toLowerCase()
    .replace(/[/\\#?%\x00-\x1f\x7f]/g, ' ')   // Firestore ID 금지 문자 + 슬래시
    .replace(/^_+|_+$/g, '')                    // __ 로 시작/끝나는 예약 패턴 회피
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `game-${String(authorId).replace(/[^\w-]/g, '')}`;
}

const readText = (file) => file.text();
const readDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

// 단일 HTML 이 자체완결인지 본다. 로컬 파일을 가리키는 src/href 가 있으면 아니다.
// (http(s):, data:, #, mailto:, // 는 외부/인라인이라 괜찮다)
function isSelfContained(html) {
  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  return !refs.some((ref) => {
    const v = ref.trim();
    if (!v) return false;
    return !/^(https?:|data:|blob:|mailto:|tel:|#|\/\/)/i.test(v);
  });
}

// 업로드된 파일 목록을 분류한다.
//   { kind: 'instant', html }                  단일 자체완결 HTML
//   { kind: 'bundle', files: [{path, dataUrl}] } 여러 파일
export async function classify(fileList) {
  const files = [...fileList].filter((f) => {
    // 폴더 업로드 시 딸려오는 노이즈 제외
    const p = (f.webkitRelativePath || f.name);
    return !/(^|\/)(node_modules|\.git|\.DS_Store|dist|build|out)(\/|$)/.test(p);
  });

  if (!files.length) throw new SubmitError('올릴 파일을 선택하세요.');

  const htmls = files.filter((f) => /\.html?$/i.test(f.name));

  // 단일 HTML 하나뿐이면 즉시 게시 후보
  if (files.length === 1 && htmls.length === 1) {
    if (files[0].size >= INSTANT_MAX) {
      throw new SubmitError('파일이 너무 큽니다(0.9MB 초과). 이미지를 줄이거나 여러 파일로 나눠 올려 주세요.');
    }
    const html = await readText(files[0]);
    if (isSelfContained(html)) return { kind: 'instant', html };
    // 외부 파일을 참조하는데 그 파일이 없으므로 멀티파일로 보내도 깨진다.
    throw new SubmitError('이 HTML 이 다른 파일(이미지·스크립트)을 참조하고 있습니다. 참조하는 파일들을 함께 선택해 폴더째 올려 주세요.');
  }

  // 여러 파일 → 번들. 진입점 index.html 이 있어야 한다(빌드형은 package.json).
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > BUNDLE_MAX) {
    throw new SubmitError(`파일 합계가 너무 큽니다(${(total / 1048576).toFixed(1)}MB > 8MB). node_modules 를 제외했는지 확인하세요.`);
  }

  const rel = (f) => (f.webkitRelativePath || f.name).replace(/^[^/]+\//, ''); // 최상위 폴더 한 겹 제거
  const paths = files.map(rel);
  const hasIndex = paths.some((p) => p === 'index.html' || p.endsWith('/index.html'));
  const hasPkg = paths.some((p) => p === 'package.json' || p.endsWith('/package.json'));
  if (!hasIndex && !hasPkg) {
    throw new SubmitError('index.html 또는 package.json 이 없습니다. 게임 폴더째 선택했는지 확인하세요.');
  }

  const out = [];
  for (const f of files) {
    out.push({ path: rel(f), dataUrl: await readDataUrl(f) });
  }
  return { kind: 'bundle', files: out };
}

// 즉시 게시: 메타 문서 + content/html 을 한 배치로 쓴다.
export async function publishInstant(fb, { slug, meta, html, uid }) {
  const { doc, getDoc, writeBatch, serverTimestamp } = fb.fs;

  const metaRef = doc(fb.db, 'gamehub_instant', slug);
  const existing = await getDoc(metaRef);
  if (existing.exists() && existing.data().by !== uid) {
    throw new SubmitError('같은 이름의 게임이 이미 있습니다. 제목을 조금 바꿔 주세요.');
  }

  const batch = writeBatch(fb.db);
  batch.set(metaRef, {
    title: meta.title,
    author: meta.author,
    authorId: meta.authorId,
    cohort: meta.cohort || '',
    description: meta.description || '',
    tags: meta.tags || [],
    by: uid,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(fb.db, 'gamehub_instant', slug, 'content', 'html'), { html });
  await batch.commit();
}

// 멀티파일: gamehubSubmit 함수로 넘긴다. 함수가 PR 생성·자동머지한다.
export async function publishBundle(fb, { slug, meta, files }) {
  const call = fb.fns.httpsCallable(fb.functions, 'gamehubSubmit');
  const res = await call({ slug, meta, files });
  return res.data; // { prUrl, merged }
}
