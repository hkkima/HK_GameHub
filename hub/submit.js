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

// 즉시 게시 게임의 문서 ID.
//
// 제목을 키로 쓰지 않는다. 제목을 바꾸면 다른 게임이 되고, 같은 제목이면 서로
// 충돌하기 때문이다. 대신 게시할 때 고유 ID 를 한 번 발급해 그걸로 고정한다.
// 제목은 그냥 바꿀 수 있는 필드가 된다.
export function newGameId() {
  if (globalThis.crypto?.randomUUID) return 'g-' + crypto.randomUUID();
  // 아주 오래된 브라우저 대비 폴백
  const rnd = () => Math.floor(Math.random() * 1e9).toString(36);
  return `g-${rnd()}${rnd()}`;
}

const readText = (file) => file.text();

// 썸네일 이미지를 작은 JPEG data URI 로 줄인다. 갤러리 메타 문서에 함께 담기므로
// 작아야 한다(규칙 상한 80KB). 긴 변을 max 로 맞추고 품질을 낮춰 재시도한다.
export async function makeThumb(file, max = 320) {
  if (!/^image\//.test(file.type)) throw new SubmitError('이미지 파일을 선택하세요.');

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new SubmitError('이미지를 읽지 못했습니다.'));
      i.src = url;
    });

    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);

    for (const q of [0.72, 0.6, 0.45, 0.3]) {
      const uri = canvas.toDataURL('image/jpeg', q);
      if (uri.length < 78000) return uri;
    }
    throw new SubmitError('썸네일 이미지가 너무 큽니다. 더 작은 이미지를 써 주세요.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
const readDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

// 단일 HTML 이 자체완결인지 본다. 로컬 파일을 가리키는 src/href 가 있으면 아니다.
//
// 오탐 주의: 게임 JS 안에 `<img src="${x}">` 같은 템플릿 문자열이 흔하다. 그건
// 런타임에 data URI 등을 채우는 코드지 실제 파일 참조가 아니다. 그래서
//   1) <script>...</script> 안은 통째로 제외하고
//   2) 남은 마크업에서만 태그 속성을 보고
//   3) 값에 ${ 나 <%= 같은 템플릿 표현식이 있으면 정적 참조가 아니므로 건너뛴다.
function isSelfContained(html) {
  // 스크립트 "본문" 만 지운다. 여는 태그(<script src=...>)는 남겨서 외부 스크립트
  // 참조는 여전히 검사되게 한다. 본문 안의 `<img src="${x}">` 같은 문자열만 사라진다.
  const markup = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1');

  // 태그 안의 src/href 속성만 본다
  const attrs = [...markup.matchAll(
    /<[a-z][^>]*?\b(?:src|href)\s*=\s*["']([^"']*)["'][^>]*>/gi,
  )].map((m) => m[1]);

  return !attrs.some((ref) => {
    const v = ref.trim();
    if (!v) return false;
    if (/[$#{}]|<%/.test(v)) return false;            // 템플릿 표현식은 정적 참조가 아니다
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

// 즉시 게시. 신규(slug 새로 발급)와 수정(기존 slug)을 모두 처리한다.
//   html 이 주어지면 게임 파일을 새로/교체 저장하고, 없으면(수정 시 파일 미교체)
//   기존 content 를 그대로 둔다.
export async function publishInstant(fb, { slug, meta, html, uid }) {
  const { doc, getDoc, writeBatch, serverTimestamp } = fb.fs;

  const metaRef = doc(fb.db, 'gamehub_instant', slug);
  const existing = await getDoc(metaRef);
  // 소유는 참가자(authorId) 기준. 남의 게임은 수정할 수 없다.
  if (existing.exists() && existing.data().authorId !== meta.authorId) {
    throw new SubmitError('이 게임을 수정할 권한이 없습니다.');
  }
  if (!existing.exists() && !html) {
    throw new SubmitError('게임 파일을 선택하세요.');
  }

  const metaDoc = {
    title: meta.title,
    author: meta.author,
    authorId: meta.authorId,
    cohort: meta.cohort || '',
    description: meta.description || '',
    tags: meta.tags || [],
    by: uid,
    createdAt: existing.exists()
      ? (existing.data().createdAt || serverTimestamp())
      : serverTimestamp(),
  };
  if (meta.thumb) metaDoc.thumb = meta.thumb;

  const batch = writeBatch(fb.db);
  batch.set(metaRef, metaDoc);
  if (html) batch.set(doc(fb.db, 'gamehub_instant', slug, 'content', 'html'), { html });
  await batch.commit();
}

// 즉시 게시 게임 삭제. 메타와 content 를 함께 지운다.
export async function deleteInstant(fb, slug) {
  const { doc, writeBatch } = fb.fs;
  const batch = writeBatch(fb.db);
  batch.delete(doc(fb.db, 'gamehub_instant', slug, 'content', 'html'));
  batch.delete(doc(fb.db, 'gamehub_instant', slug));
  await batch.commit();
}

// 멀티파일: gamehubSubmit 함수로 넘긴다. 함수가 PR 생성·자동머지한다.
export async function publishBundle(fb, { slug, meta, files }) {
  const call = fb.fns.httpsCallable(fb.functions, 'gamehubSubmit');
  const res = await call({ slug, meta, files });
  return res.data; // { prUrl, merged }
}
