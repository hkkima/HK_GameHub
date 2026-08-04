// 운영자 화면 — 주간 좋아요 포인트 승인
//
// 강사가 Google 로 로그인하면(운영자 이메일만 통과) 지급 대기 목록과 예상 총액을
// 보여주고, 승인 버튼 한 번으로 gamehubPayout 함수를 호출한다.
//
// 지급 판정과 실제 잔액 증가는 전부 함수(Admin SDK)가 한다. 이 화면은 미리보기와
// 호출만 담당하며, 여기서 숫자를 바꿔도 서버가 다시 계산한다.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const won = (n) => Number(n || 0).toLocaleString('ko-KR');

export function createAdminPanel({ fb, root, onToast }) {
  let preview = null;
  let busy = false;

  const call = (name, data) => fb.fns.httpsCallable(fb.functions, name)(data);

  function setBusy(v) {
    busy = v;
    root.querySelectorAll('button').forEach((b) => { b.disabled = v; });
  }

  function renderEmpty(message) {
    root.querySelector('[data-admin-body]').innerHTML =
      `<p class="admin-empty">${esc(message)}</p>`;
  }

  function renderPreview() {
    const body = root.querySelector('[data-admin-body]');

    if (!preview || preview.totalLikes === 0) {
      renderEmpty('지급할 좋아요가 없습니다.');
      root.querySelector('[data-approve]').hidden = true;
      return;
    }

    const rows = preview.rows.map((r) => `
      <tr>
        <td>${esc(r.title)}</td>
        <td>${esc(r.authorName)}</td>
        <td class="num">${r.likes}</td>
        <td class="num">${won(r.points)}</td>
      </tr>`).join('');

    const problems = (preview.problems || []).length
      ? `<div class="admin-problems">
           <strong>제외된 항목</strong>
           <ul>${preview.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
         </div>`
      : '';

    body.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>게임</th><th>제작자</th><th class="num">좋아요</th><th class="num">포인트</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2">합계 (1 좋아요 = ${won(preview.pointsPerLike)}P)</td>
            <td class="num">${preview.totalLikes}</td>
            <td class="num">${won(preview.totalPoints)}</td>
          </tr>
        </tfoot>
      </table>
      ${problems}`;

    root.querySelector('[data-approve]').hidden = false;
  }

  async function refresh() {
    setBusy(true);
    renderEmpty('불러오는 중…');
    try {
      const res = await call('gamehubPayout', { dryRun: true });
      preview = res.data;
      renderPreview();
    } catch (err) {
      console.error('[HK GameHub] 지급 미리보기 실패', err);
      renderEmpty(err?.message || '지급 대기 목록을 불러오지 못했습니다.');
      root.querySelector('[data-approve]').hidden = true;
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!preview || preview.totalLikes === 0) return;

    const ok = confirm(
      `${preview.rows.length}개 게임, 좋아요 ${preview.totalLikes}건에 대해 ` +
      `총 ${won(preview.totalPoints)}P 를 지급합니다.\n\n계속할까요?`
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await call('gamehubPayout', {
        dryRun: false,
        pointsPerLike: preview.pointsPerLike,
      });
      onToast(`지급 완료 — ${won(res.data.totalPoints)}P (회차 ${res.data.payoutId})`);
      await refresh();
    } catch (err) {
      console.error('[HK GameHub] 지급 실패', err);
      onToast(err?.message || '지급에 실패했습니다.');
      setBusy(false);
    }
  }

  root.innerHTML = `
    <div class="admin-head">
      <h2>주간 좋아요 포인트 승인</h2>
      <div class="admin-actions">
        <button type="button" class="btn btn-ghost" data-refresh>새로고침</button>
        <button type="button" class="btn btn-primary" data-approve hidden>승인하고 지급</button>
      </div>
    </div>
    <div data-admin-body></div>`;

  root.querySelector('[data-refresh]').addEventListener('click', refresh);
  root.querySelector('[data-approve]').addEventListener('click', approve);

  return { refresh, get busy() { return busy; } };
}
