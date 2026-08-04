#!/usr/bin/env node
//
// HK GameHub 빌드
//
//   apps/<slug>/ 를 훑어서
//     - package.json 이 있으면  : 의존성 설치 후 빌드하고 산출물 디렉터리를 가져온다
//     - 없으면                  : 폴더를 그대로 복사한다
//
//   결과
//     dist/hub/            -> Cloudflare Pages 프로젝트 "hk-gamehub" 로 배포
//     dist/games/g/<slug>/ -> Cloudflare Pages 프로젝트 "hk-games" 로 배포
//
//   사용법
//     node scripts/build.mjs            전체 빌드
//     node scripts/build.mjs <slug>     특정 앱만 빌드 (PR 검증용)
//
// 보안: 수강생 코드의 package.json 라이프사이클 스크립트는 --ignore-scripts 로 막는다.
// postinstall 하나로 CI 러너에서 임의 코드가 도는 것을 방지하기 위함이다.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPS_DIR = path.join(ROOT, 'apps');
const HUB_DIR = path.join(ROOT, 'hub');
const DIST = path.join(ROOT, 'dist');
const OUT_HUB = path.join(DIST, 'hub');
const OUT_GAMES = path.join(DIST, 'games');

const HUB_ORIGIN = process.env.HUB_ORIGIN || 'https://hk-gamehub.pages.dev';

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;
const BUILD_OUT_CANDIDATES = ['dist', 'build', 'out', 'public'];
const COPY_DENY = new Set([
  'node_modules', '.git', '.github', '.vscode', '.idea', '.DS_Store',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'manifest.json', 'README.md', '.gitignore', '.env', '.env.local',
]);

const onlySlug = process.argv[2] || null;

const log = (...a) => console.log('   ', ...a);
const step = (...a) => console.log('\n▸', ...a);

const problems = [];
function fail(slug, msg) {
  problems.push(`apps/${slug}: ${msg}`);
}

// ---------------------------------------------------------------------------
// 매니페스트
// ---------------------------------------------------------------------------

function validateManifest(slug, raw) {
  const m = { ...raw };

  if (typeof m.title !== 'string' || !m.title.trim()) {
    fail(slug, 'manifest.json 에 title 이 없습니다.');
    return null;
  }
  if (typeof m.author !== 'string' || !m.author.trim()) {
    fail(slug, 'manifest.json 에 author 가 없습니다.');
    return null;
  }
  if (m.tags != null && !Array.isArray(m.tags)) {
    fail(slug, 'tags 는 배열이어야 합니다. 예: ["액션", "퍼즐"]');
    return null;
  }

  // authorId 는 좋아요 포인트를 받을 학급 계정(users 문서 ID)이다.
  // 실제로 존재하는 참가자인지는 지급 함수가 확인한다. 여기서는 형식만 본다.
  // 없으면 갤러리에는 올라가되 포인트 지급 대상에서 빠지므로 경고만 낸다.
  const authorId = typeof m.authorId === 'string' ? m.authorId.trim().toLowerCase() : '';
  if (!authorId) {
    log(`경고: ${slug} 에 authorId 가 없어 좋아요 포인트를 받을 수 없습니다.`);
  } else if (/\s/.test(authorId)) {
    fail(slug, 'authorId 에는 공백을 쓸 수 없습니다. 이름의 공백은 _ 로 바꾸세요.');
    return null;
  }

  return {
    slug,
    title: m.title.trim(),
    author: m.author.trim(),
    authorId,
    cohort: typeof m.cohort === 'string' ? m.cohort.trim() : '',
    description: typeof m.description === 'string' ? m.description.trim() : '',
    tags: (m.tags || []).map((t) => String(t).trim()).filter(Boolean),
    thumb: typeof m.thumb === 'string' ? m.thumb.replace(/^\.?\//, '') : '',
    spa: m.spa === true,
    outDir: typeof m.outDir === 'string' ? m.outDir : '',
    addedAt: typeof m.addedAt === 'string' ? m.addedAt : '',
  };
}

// 앱 폴더가 처음 커밋된 날짜. 최신순 정렬의 기준이 된다.
// (workflow 에서 fetch-depth: 0 이어야 제대로 나온다)
function firstCommitDate(dir) {
  try {
    const out = execFileSync(
      'git',
      ['log', '--diff-filter=A', '--follow', '--format=%aI', '--', dir],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim().split('\n').filter(Boolean);
    return out[out.length - 1] || '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 앱 빌드
// ---------------------------------------------------------------------------

async function resolveOutDir(appDir, manifest) {
  const candidates = manifest.outDir ? [manifest.outDir] : BUILD_OUT_CANDIDATES;
  for (const c of candidates) {
    const p = path.join(appDir, c);
    if (existsSync(path.join(p, 'index.html'))) return p;
  }
  return null;
}

async function buildApp(slug) {
  const appDir = path.join(APPS_DIR, slug);
  const target = path.join(OUT_GAMES, 'g', slug);

  const manifestPath = path.join(appDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail(slug, 'manifest.json 이 없습니다. apps/_template/manifest.json 을 참고하세요.');
    return null;
  }

  let raw;
  try {
    raw = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (err) {
    fail(slug, `manifest.json 이 올바른 JSON 이 아닙니다. (${err.message})`);
    return null;
  }

  const manifest = validateManifest(slug, raw);
  if (!manifest) return null;

  const hasPackageJson = existsSync(path.join(appDir, 'package.json'));
  let sourceDir = appDir;

  if (hasPackageJson) {
    step(`${slug} — 프론트엔드 앱으로 빌드`);

    const pkg = JSON.parse(await readFile(path.join(appDir, 'package.json'), 'utf8'));
    if (!pkg.scripts?.build) {
      fail(slug, 'package.json 에 scripts.build 가 없습니다. 빌드가 필요 없다면 package.json 을 지우세요.');
      return null;
    }

    const hasLock = existsSync(path.join(appDir, 'package-lock.json'));
    const install = hasLock
      ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
      : ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'];

    try {
      log(`npm ${install[0]} …`);
      execFileSync('npm', install, { cwd: appDir, stdio: 'inherit' });
      log('npm run build …');
      execFileSync('npm', ['run', 'build'], {
        cwd: appDir,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production', CI: '1' },
      });
    } catch {
      fail(slug, '빌드에 실패했습니다. 로컬에서 npm run build 가 통과하는지 확인하세요.');
      return null;
    }

    const outDir = await resolveOutDir(appDir, manifest);
    if (!outDir) {
      fail(slug, `빌드 산출물에서 index.html 을 찾지 못했습니다. (탐색 위치: ${(manifest.outDir ? [manifest.outDir] : BUILD_OUT_CANDIDATES).join(', ')})`);
      return null;
    }
    sourceDir = outDir;
    log(`산출물: ${path.relative(ROOT, outDir)}`);
  } else {
    step(`${slug} — 정적 파일로 복사`);
  }

  if (!existsSync(path.join(sourceDir, 'index.html'))) {
    fail(slug, 'index.html 이 없습니다. 게임의 진입점은 반드시 index.html 이어야 합니다.');
    return null;
  }

  await mkdir(target, { recursive: true });
  await cp(sourceDir, target, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(sourceDir, src);
      if (!rel) return true;
      const first = rel.split(path.sep)[0];
      // 빌드 산출물 디렉터리는 이미 정제되어 있으므로 원본 폴더일 때만 걸러낸다
      if (sourceDir === appDir && COPY_DENY.has(first)) return false;
      if (sourceDir === appDir && BUILD_OUT_CANDIDATES.includes(first)) return false;
      return true;
    },
  });

  // 빌드된 앱은 썸네일이 산출물에 없을 수 있으니 원본에서 한 번 더 챙긴다
  if (manifest.thumb && !existsSync(path.join(target, manifest.thumb))) {
    const fromSource = path.join(appDir, manifest.thumb);
    if (existsSync(fromSource)) {
      await mkdir(path.dirname(path.join(target, manifest.thumb)), { recursive: true });
      await cp(fromSource, path.join(target, manifest.thumb));
    } else {
      log(`경고: thumb 로 지정한 ${manifest.thumb} 을 찾지 못했습니다. 기본 썸네일이 표시됩니다.`);
      manifest.thumb = '';
    }
  }

  manifest.addedAt = manifest.addedAt || firstCommitDate(path.relative(ROOT, appDir)) || new Date().toISOString();
  delete manifest.outDir;

  log(`→ dist/games/g/${slug}/`);
  return manifest;
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

async function discoverSlugs() {
  if (!existsSync(APPS_DIR)) return [];
  const entries = await readdir(APPS_DIR, { withFileTypes: true });

  const slugs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue; // _template 등
    if (!SLUG_RE.test(e.name)) {
      problems.push(`apps/${e.name}: 폴더 이름은 영소문자, 숫자, - _ . 만 쓸 수 있습니다.`);
      continue;
    }
    slugs.push(e.name);
  }
  return slugs.sort();
}

async function main() {
  step('출력 디렉터리 정리');
  await rm(DIST, { recursive: true, force: true });
  await mkdir(path.join(OUT_GAMES, 'g'), { recursive: true });
  await mkdir(OUT_HUB, { recursive: true });

  let slugs = await discoverSlugs();
  if (onlySlug) {
    if (!slugs.includes(onlySlug)) {
      console.error(`\napps/${onlySlug} 을 찾을 수 없습니다.`);
      process.exit(1);
    }
    slugs = [onlySlug];
  }
  log(`대상 앱 ${slugs.length}개`);

  const games = [];
  for (const slug of slugs) {
    const manifest = await buildApp(slug);
    if (manifest) games.push(manifest);
  }

  step('허브 조립');
  await cp(HUB_DIR, OUT_HUB, { recursive: true });

  games.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  await writeFile(path.join(OUT_HUB, 'games.json'), JSON.stringify(games, null, 2) + '\n');
  log(`games.json — ${games.length}개 등록`);

  await writeFile(path.join(OUT_HUB, '_headers'), [
    '/*',
    '  X-Frame-Options: DENY',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '',
    '/games.json',
    '  Cache-Control: public, max-age=60',
    '',
  ].join('\n'));

  // 게임은 허브에서만 iframe 으로 열리게 한다.
  // 다른 사이트가 남의 과제물을 임의로 임베드하는 것을 막는다.
  await writeFile(path.join(OUT_GAMES, '_headers'), [
    '/*',
    `  Content-Security-Policy: frame-ancestors ${HUB_ORIGIN} http://localhost:* http://127.0.0.1:*`,
    '  X-Content-Type-Options: nosniff',
    '',
  ].join('\n'));

  // SPA 라우팅을 쓰는 앱만 각자 경로 안에서 index.html 로 폴백시킨다
  const spa = games.filter((g) => g.spa);
  if (spa.length) {
    await writeFile(
      path.join(OUT_GAMES, '_redirects'),
      spa.map((g) => `/g/${g.slug}/* /g/${g.slug}/index.html 200`).join('\n') + '\n',
    );
    log(`_redirects — SPA 앱 ${spa.length}개`);
  }

  if (problems.length) {
    console.error(`\n빌드 중 ${problems.length}건의 문제가 있었습니다.\n`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error('');
    process.exit(1);
  }

  step(`완료 — 게임 ${games.length}개`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
