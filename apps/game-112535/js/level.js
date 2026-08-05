/* ONLY UP : ZHAO — 수직 할로우 타워 생성기
 *
 * 고정 시드 기반이라 매번 같은 탑이 만들어진다(코스 암기가 가능해야 하니까).
 * 모든 충돌체는 축 정렬 박스(AABB). 점프 성능에 맞춰 간격을 계산해 배치한다.
 */
(function () {
  'use strict';
  const OU = window.OU;
  const M = OU.M;

  const GOAL_Y = 500;          // 정점 고도(m)
  const BIN = 5;               // 브로드페이즈 Y 버킷 크기

  const RAMP = OU.gradientMap([80, 140, 210, 255]);

  OU.GOAL_Y = GOAL_Y;

  OU.buildLevel = function (scene, seed) {
    const rnd = OU.rng(seed);
    const colliders = [];
    const statics = [];        // 인스턴싱용 정적 박스 정보
    const movers = [];
    const updrafts = [];
    const checkpoints = [];
    const bounces = [];
    const dyn = [];            // 개별 메시가 필요한 충돌체
    const path = [];           // 실제 등반 경로 발판(장식 제외) — 난이도 검증용
    let markDecor = false;

    /* ---------- 충돌체 추가 ---------- */
    // topY = 윗면 높이
    function pad(x, topY, z, w, d, h, kind, mover) {
      h = h || 0.7;
      const c = {
        kind: kind || 'solid',
        cx: x, cy: topY - h / 2, cz: z,
        hx: w / 2, hy: h / 2, hz: d / 2,
        minx: 0, miny: 0, minz: 0, maxx: 0, maxy: 0, maxz: 0,
        mover: mover || null,
        dx: 0, dy: 0, dz: 0, vx: 0, vy: 0, vz: 0,
        mesh: null
      };
      refresh(c);
      colliders.push(c);
      if (!markDecor) path.push(c);
      if (mover || kind === 'bounce' || kind === 'goal' || kind === 'slip') dyn.push(c);
      else statics.push(c);
      if (kind === 'bounce') bounces.push(c);
      return c;
    }
    function refresh(c) {
      c.minx = c.cx - c.hx; c.maxx = c.cx + c.hx;
      c.miny = c.cy - c.hy; c.maxy = c.cy + c.hy;
      c.minz = c.cz - c.hz; c.maxz = c.cz + c.hz;
    }

    /* ---------- 코스 진행 커서 ---------- */
    const cur = { x: 0, y: 0.6, z: 0, ang: 0 };
    let nextCp = 34;

    function tier() { return M.clamp(cur.y / GOAL_Y, 0, 1); }

    /** 중심축에서 너무 멀어지면 안쪽으로 방향을 튼다 */
    function steer(base) {
      const r = Math.hypot(cur.x, cur.z);
      let a = cur.ang + base;
      if (r > 26) {
        const inward = Math.atan2(-cur.z, -cur.x);
        let d = ((inward - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        a += d * M.clamp((r - 26) / 14, 0, 0.55);
      }
      cur.ang = a;
      return a;
    }

    /** 원하는 최고 선속도(m/s)를 진동 주파수로 변환.
     *  위치 = base + amp*sin(2π·f·t) 이므로 최고 속도 = amp·2π·f */
    function hz(vmax, amp) { return vmax / (Math.max(0.5, amp) * Math.PI * 2); }

    function advance(dist, rise, turn) {
      const a = steer(turn || 0);
      cur.x += Math.cos(a) * dist;
      cur.z += Math.sin(a) * dist;
      cur.y += rise;
    }

    /* ---------- 패턴들 ---------- */

    // 기본 발판 연쇄
    function pHops(t) {
      const n = rnd.int(3, 6);
      for (let i = 0; i < n; i++) {
        const size = M.lerp(2.6, 1.5, t) * rnd.range(0.9, 1.15);
        advance(M.lerp(2.9, 4.6, t) * rnd.range(0.92, 1.08), rnd.range(0.5, M.lerp(1.2, 1.55, t)), rnd.range(-0.5, 0.7));
        pad(cur.x, cur.y, cur.z, size, size * rnd.range(0.85, 1.2), 0.7);
      }
    }

    // 나선 계단
    function pStairs(t) {
      const n = rnd.int(5, 9);
      const dir = rnd.sign();
      for (let i = 0; i < n; i++) {
        advance(rnd.range(1.9, 2.5), rnd.range(0.95, 1.35), dir * rnd.range(0.24, 0.42));
        pad(cur.x, cur.y, cur.z, M.lerp(2.3, 1.5, t), M.lerp(2.3, 1.5, t), 0.7);
      }
    }

    // 좁은 외줄 다리
    function pBridge(t) {
      const a = steer(rnd.range(-0.4, 0.4));
      const len = rnd.range(8, 15);
      const w = M.lerp(1.5, 0.85, t);
      const mx = cur.x + Math.cos(a) * len / 2;
      const mz = cur.z + Math.sin(a) * len / 2;
      const rise = rnd.range(0.3, 1.0);
      // 각도에 맞춰 축 정렬 박스로 근사: 긴 축을 세분해서 계단식으로 깐다
      const steps = Math.ceil(len / 1.1);
      for (let i = 0; i < steps; i++) {
        const f = (i + 0.5) / steps;
        pad(cur.x + Math.cos(a) * len * f, cur.y + rise * f, cur.z + Math.sin(a) * len * f,
          w + 0.5, w + 0.5, 0.55);
      }
      cur.x += Math.cos(a) * len; cur.z += Math.sin(a) * len; cur.y += rise;
      void mx; void mz;
    }

    // 기둥 꼭대기 점프
    function pPillars(t) {
      const n = rnd.int(3, 5);
      for (let i = 0; i < n; i++) {
        const s = M.lerp(1.9, 1.15, t);
        advance(M.lerp(3.2, 4.9, t), rnd.range(0.7, M.lerp(1.4, 1.7, t)), rnd.range(-0.65, 0.8));
        const h = rnd.range(3, 9);
        pad(cur.x, cur.y, cur.z, s, s, h);
      }
    }

    // 트램폴린 패드로 고도 급상승
    function pBounce(t) {
      advance(rnd.range(2.8, 3.8), rnd.range(0.2, 0.9), rnd.range(-0.5, 0.5));
      pad(cur.x, cur.y, cur.z, 2.6, 2.6, 0.6, 'bounce');
      // 스페이스를 안 눌러도 닿는 높이(도약 최고점 5.6m)로 제한
      const rise = rnd.range(4.0, 5.0);
      const size = M.lerp(3.0, 2.2, t);
      // 착지 발판이 트램폴린 위를 덮으면 도약 중 밑면에 막힌다 → 한 축으로만 밀어 분리
      const a = steer(rnd.range(-0.7, 0.7));
      const useX = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a));
      const sgn = useX ? (Math.cos(a) < 0 ? -1 : 1) : (Math.sin(a) < 0 ? -1 : 1);
      const d = 1.3 + size / 2 + 0.7;
      cur.x += useX ? sgn * d : 0;
      cur.z += useX ? 0 : sgn * d;
      cur.y += rise;
      pad(cur.x, cur.y, cur.z, size, size, 0.8);
    }

    // 왕복 이동 발판으로 넓은 공백 건너기
    function pFerry(t) {
      advance(rnd.range(2.4, 3.2), rnd.range(0.2, 0.8), rnd.range(-0.4, 0.4));
      pad(cur.x, cur.y, cur.z, 2.8, 2.8, 0.8);
      // 이동 축을 X/Z 중 하나로 스냅한다. 대각선으로 배치하면 축 성분이 0.707배로
      // 줄어들어 양 끝 발판의 AABB 와 겹치기 때문(골인·트램폴린과 같은 이유).
      const a = steer(rnd.range(-0.3, 0.3));
      const useX = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a));
      const sgn = useX ? (Math.cos(a) < 0 ? -1 : 1) : (Math.sin(a) < 0 ? -1 : 1);
      const span = rnd.range(10, 16);
      const rise = rnd.range(1.2, 3.0);
      const size = M.lerp(2.6, 1.9, t);
      const ex = cur.x + (useX ? sgn * span : 0);
      const ez = cur.z + (useX ? 0 : sgn * span);
      // 왕복 끝에서 양 끝 발판(반폭 1.4)과 확실히 떨어지도록 진폭을 줄인다
      const ampF = Math.max(1.2, span / 2 - (1.4 + size / 2 + 0.6));
      // mover 의 by/bx/bz 는 충돌체 "중심" 기준이므로 윗면 높이는 +h/2
      const mid = {
        type: 'lin',
        bx: (cur.x + ex) / 2, by: cur.y + rise * 0.5 - 0.3, bz: (cur.z + ez) / 2,
        ax: useX ? sgn : 0, ay: 0, az: useX ? 0 : sgn,
        amp: ampF, spd: hz(rnd.range(2.4, 3.4), ampF), ph: rnd.range(0, 6.28)
      };
      const c = pad(mid.bx, mid.by + 0.3, mid.bz, size, size, 0.6, 'solid', mid);
      movers.push(c);
      cur.x = ex; cur.z = ez; cur.y += rise;
      pad(cur.x, cur.y, cur.z, 2.8, 2.8, 0.8);
    }

    // 수직 엘리베이터
    function pElevator(t) {
      advance(rnd.range(2.4, 3.4), rnd.range(0.2, 0.8), rnd.range(-0.5, 0.5));
      pad(cur.x, cur.y, cur.z, 2.6, 2.6, 0.8);
      const lift = rnd.range(7, 13);
      // 승강대도 한 축으로만 밀어낸다(대각선 배치 시 발판과 겹침)
      const a = steer(rnd.range(-0.25, 0.25));
      const useX = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a));
      const sgn = useX ? (Math.cos(a) < 0 ? -1 : 1) : (Math.sin(a) < 0 ? -1 : 1);
      const size = M.lerp(2.6, 2.1, t);
      const bd = 1.4 + size / 2 + 0.7;                  // 승강대 ↔ 발판 거리
      // 승강대 윗면이 아래쪽 발판(cur.y) ↔ 위쪽 발판(cur.y+lift) 과 정확히 맞도록
      const mv = {
        type: 'lin',
        bx: cur.x + (useX ? sgn * bd : 0), by: cur.y + lift / 2 - 0.3,
        bz: cur.z + (useX ? 0 : sgn * bd),
        ax: 0, ay: 1, az: 0, amp: lift / 2,
        spd: hz(rnd.range(2.8, 3.8), lift / 2), ph: rnd.range(0, 6.28)
      };
      const c = pad(mv.bx, mv.by + 0.3, mv.bz, size, size, 0.6, 'solid', mv);
      movers.push(c);
      cur.y += lift;
      cur.x += useX ? sgn * bd * 2 : 0;
      cur.z += useX ? 0 : sgn * bd * 2;
      pad(cur.x, cur.y, cur.z, 2.8, 2.8, 0.8);
    }

    // 원형 궤도 발판
    function pOrbit(t) {
      advance(rnd.range(2.6, 3.4), rnd.range(0.3, 0.9), rnd.range(-0.4, 0.4));
      pad(cur.x, cur.y, cur.z, 2.6, 2.6, 0.8);
      const R = rnd.range(4.0, 5.5);
      // 궤도 발판은 모든 각도를 지나므로 축 스냅으로는 해결이 안 된다.
      // 원의 최근접 거리가 판정 정사각형의 대각 반경(반폭합 2.8 × √2 ≈ 3.96)보다
      // 크면 어떤 각도에서도 AABB 가 겹치지 않는다.
      const GAP = 4.25;                                  // 궤도와 발판 사이 여유
      const a = steer(rnd.range(-0.2, 0.2));
      const ccx = cur.x + Math.cos(a) * (R + GAP), ccz = cur.z + Math.sin(a) * (R + GAP);
      const n = rnd.int(2, 3);
      const spd = hz(rnd.range(2.4, 3.2), R) * rnd.sign();
      const orbY = cur.y + rnd.range(0.5, 1.1);
      const size = M.lerp(2.7, 2.1, t);
      for (let i = 0; i < n; i++) {
        const mv = {
          type: 'orb', cx: ccx, cy: orbY - 0.275, cz: ccz,
          r: R, spd: spd, ph: (Math.PI * 2 * i) / n + a + Math.PI
        };
        const c = pad(ccx, orbY, ccz, size, size, 0.55, 'solid', mv);
        movers.push(c);
      }
      // 출구는 원의 반대편 바깥
      cur.x = ccx + Math.cos(a) * (R + GAP); cur.z = ccz + Math.sin(a) * (R + GAP);
      cur.y = orbY + rnd.range(0.7, 1.5);
      pad(cur.x, cur.y, cur.z, 2.9, 2.9, 0.8);
    }

    // 상승 기류 샤프트
    function pUpdraft(t) {
      advance(rnd.range(2.6, 3.6), rnd.range(0.3, 0.9), rnd.range(-0.4, 0.4));
      pad(cur.x, cur.y, cur.z, 2.6, 2.6, 0.8);            // 진입 발판
      const a = steer(rnd.range(-0.3, 0.3));
      const R = 2.6;                                      // 기류 반경
      const ux = cur.x + Math.cos(a) * 3.4, uz = cur.z + Math.sin(a) * 3.4;
      const lift = rnd.range(9, 15);
      const exitTop = cur.y + lift;
      const exitSize = M.lerp(3.2, 2.4, t);
      // 발판이 기류 위를 덮으면 상승 중에 밑면에 갇힌다 → 반경 밖으로 밀어낸다
      const exitDist = R + exitSize / 2 + 0.35;
      updrafts.push({ x: ux, z: uz, y0: cur.y - 1, y1: exitTop + 3.0, r: R });
      // 샤프트 옆 중간 쉼터 (역시 기류 밖)
      pad(ux + Math.cos(a + 2.0) * (R + 1.35), cur.y + lift * 0.45,
        uz + Math.sin(a + 2.0) * (R + 1.35), 1.8, 1.8, 0.5);
      cur.y = exitTop;
      cur.x = ux + Math.cos(a) * exitDist;
      cur.z = uz + Math.sin(a) * exitDist;
      pad(cur.x, cur.y, cur.z, exitSize, exitSize, 0.8);
    }

    // 미끄러운 패드
    function pSlip(t) {
      const n = rnd.int(2, 4);
      for (let i = 0; i < n; i++) {
        advance(rnd.range(3.0, 4.2), rnd.range(0.4, 1.3), rnd.range(-0.6, 0.6));
        pad(cur.x, cur.y, cur.z, M.lerp(3.0, 2.1, t), M.lerp(3.0, 2.1, t), 0.6, 'slip');
      }
    }

    // 지그재그 좁은 발판
    function pZigzag(t) {
      const n = rnd.int(4, 7);
      let s = rnd.sign();
      for (let i = 0; i < n; i++) {
        advance(M.lerp(3.0, 4.3, t), rnd.range(0.6, M.lerp(1.2, 1.55, t)), s * rnd.range(0.5, 0.95));
        s = -s;
        const w = M.lerp(2.1, 1.3, t);
        pad(cur.x, cur.y, cur.z, w, w, 0.6);
      }
    }

    // 넓은 쉼터 + 정착지
    function pRest() {
      advance(rnd.range(2.8, 3.8), rnd.range(0.4, 1.1), rnd.range(-0.5, 0.5));
      pad(cur.x, cur.y, cur.z, 5.6, 5.6, 1.0);
      // 장식 아치
      markDecor = true;
      pad(cur.x - 2.4, cur.y + 3.4, cur.z, 0.35, 0.35, 3.4);
      pad(cur.x + 2.4, cur.y + 3.4, cur.z, 0.35, 0.35, 3.4);
      markDecor = false;
      checkpoints.push({ x: cur.x, y: cur.y, z: cur.z, active: false, ring: null, idx: checkpoints.length + 1 });
    }

    /* ---------- 시작 광장 ---------- */
    pad(0, 0.6, 0, 14, 14, 1.2);
    markDecor = true;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pad(Math.cos(a) * 6.2, 0.6 + 2.6, Math.sin(a) * 6.2, 0.5, 0.5, 2.6);
    }
    markDecor = false;
    checkpoints.push({ x: 0, y: 0.6, z: 0, active: true, ring: null, idx: 0 });
    cur.x = 4; cur.z = 0; cur.y = 0.6; cur.ang = 0.2;

    /* ---------- 타워 생성 루프 ---------- */
    const EASY = [pHops, pStairs, pBridge, pHops, pStairs];
    const MID = [pHops, pStairs, pPillars, pBounce, pFerry, pZigzag, pBridge, pElevator];
    const HARD = [pPillars, pZigzag, pOrbit, pUpdraft, pFerry, pBounce, pSlip, pElevator, pHops];
    const BRUTAL = [pPillars, pZigzag, pOrbit, pSlip, pUpdraft, pOrbit, pPillars];

    let guard = 0;
    while (cur.y < GOAL_Y - 16 && guard++ < 900) {
      const t = tier();
      const set = t < 0.16 ? EASY : t < 0.45 ? MID : t < 0.78 ? HARD : BRUTAL;
      rnd.pick(set)(t);
      if (cur.y >= nextCp) { pRest(); nextCp = cur.y + rnd.range(30, 42); }
    }

    /* ---------- 정점 접근 계단 ----------
     * 마지막 구간은 무조건 도달 가능해야 하므로 상승량을 직접 통제한다
     * (예전에는 남은 높이를 한 번에 올리려 해서 골인 발판이 직전 발판 위를 덮었다) */
    while (cur.y < GOAL_Y - 2.0) {
      const rise = M.clamp(GOAL_Y - 2.0 - cur.y, 0.5, 1.3);
      advance(rnd.range(2.5, 3.2), rise, rnd.range(-0.45, 0.45));
      pad(cur.x, cur.y, cur.z, 2.5, 2.5, 0.7);
    }
    // 골인 직전 발판: 윗면을 정확히 GOAL_Y - 1.0 에 맞춘다
    advance(rnd.range(2.6, 3.2), (GOAL_Y - 1.0) - cur.y, 0.2);
    cur.y = GOAL_Y - 1.0;
    const approach = pad(cur.x, cur.y, cur.z, 3.4, 3.4, 0.9);

    /* ---------- 골인 지점 ----------
     * 수평 5.8m / 상승 1.0m. 골인 발판(반폭 3.0)과 직전 발판(반폭 1.7)이
     * 절대 겹치지 않으면서(5.8 > 3.0+1.7) 실제 점프 거리는 1.1m 뿐이다. */
    /* AABB 는 축 정렬이라 대각선으로 밀면 각 축 성분이 줄어들어 여전히 겹친다.
     * → 지배적인 축 하나로만 밀어서 그 축에서 확실히 분리시킨다. */
    const ga = steer(0.15);
    const GOAL_HALF = 3.0;
    const GOAL_GAP = GOAL_HALF + 1.7 + 1.1;     // 3.0 + 직전발판 반폭 + 실제 점프거리
    const useX = Math.abs(Math.cos(ga)) >= Math.abs(Math.sin(ga));
    const sgn = useX ? (Math.cos(ga) < 0 ? -1 : 1) : (Math.sin(ga) < 0 ? -1 : 1);
    const gx = cur.x + (useX ? sgn * GOAL_GAP : 0);
    const gz = cur.z + (useX ? 0 : sgn * GOAL_GAP);
    const goal = pad(gx, GOAL_Y, gz, GOAL_HALF * 2, GOAL_HALF * 2, 1.4, 'goal');
    const goalPos = new THREE.Vector3(gx, GOAL_Y, gz);
    // 왕관 기둥 — 올라오는 쪽은 비워둔다
    markDecor = true;
    const openAng = Math.atan2(cur.z - gz, cur.x - gx);
    cur.x = gx; cur.z = gz; cur.y = GOAL_Y;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const d = Math.abs(((a - openAng + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      if (d < 0.62) continue;
      pad(gx + Math.cos(a) * 2.45, GOAL_Y + 2.2 + Math.sin(i * 1.7) * 0.5, gz + Math.sin(a) * 2.45, 0.28, 0.28, 2.2);
    }
    markDecor = false;
    const topY = GOAL_Y;

    /* =======================================================
       렌더링 오브젝트 구성
       ======================================================= */
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const matSolid = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: RAMP });
    const matRim = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });

    /* 정적 박스 인스턴싱 */
    const iSolid = new THREE.InstancedMesh(boxGeo, matSolid, statics.length);
    const iRim = new THREE.InstancedMesh(boxGeo, matRim, statics.length);
    iSolid.castShadow = iSolid.receiveShadow = true;
    iRim.frustumCulled = false;
    iSolid.frustumCulled = false;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    for (let i = 0; i < statics.length; i++) {
      const c = statics[i];
      mtx.makeScale(c.hx * 2, c.hy * 2, c.hz * 2);
      mtx.setPosition(c.cx, c.cy, c.cz);
      iSolid.setMatrixAt(i, mtx);
      const t = M.clamp(c.cy / GOAL_Y, 0, 1);
      col.setHSL(M.lerp(0.60, 0.86, t) + rnd.range(-0.03, 0.03), 0.30, M.lerp(0.24, 0.34, rnd()));
      iSolid.setColorAt(i, col);

      // 발판 측면 네온 띠
      mtx.makeScale(c.hx * 2 + 0.10, 0.10, c.hz * 2 + 0.10);
      mtx.setPosition(c.cx, c.maxy - 0.16, c.cz);
      iRim.setMatrixAt(i, mtx);
      col.setHSL(M.lerp(0.50, 0.92, t), 0.95, 0.62);
      iRim.setColorAt(i, col);
    }
    iSolid.instanceMatrix.needsUpdate = true;
    iRim.instanceMatrix.needsUpdate = true;
    if (iSolid.instanceColor) iSolid.instanceColor.needsUpdate = true;
    if (iRim.instanceColor) iRim.instanceColor.needsUpdate = true;
    scene.add(iSolid, iRim);

    /* 개별 메시(이동 발판·트램폴린·미끄럼·정점) */
    const matMove = new THREE.MeshToonMaterial({ color: 0x2a3f6b, gradientMap: RAMP });
    const matBounce = new THREE.MeshToonMaterial({ color: 0xff2f6e, gradientMap: RAMP, emissive: 0x4a0016 });
    const matSlip = new THREE.MeshToonMaterial({ color: 0x8fe6ff, gradientMap: RAMP });
    const matGoal = new THREE.MeshToonMaterial({ color: 0xffd23f, gradientMap: RAMP, emissive: 0x3a2a00 });
    const glowTex = OU.glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');

    dyn.forEach((c) => {
      const mat = c.kind === 'bounce' ? matBounce : c.kind === 'slip' ? matSlip
        : c.kind === 'goal' ? matGoal : matMove;
      const m = new THREE.Mesh(boxGeo, mat);
      m.scale.set(c.hx * 2, c.hy * 2, c.hz * 2);
      m.position.set(c.cx, c.cy, c.cz);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      c.mesh = m;
      // 이동 발판은 밑면에 발광 코어
      if (c.mover) {
        const g = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x3ff0ff }));
        g.position.set(0, -0.52, 0);
        g.scale.set(0.7, 0.08 / (c.hy * 2), 0.7);   // 부모 스케일 기준 상대값
        m.add(g);
      }
      if (c.kind === 'bounce') {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: 0xff5f8f, transparent: true, opacity: 0.75,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        s.scale.set(5, 5, 1);
        s.position.set(c.cx, c.maxy + 0.4, c.cz);
        scene.add(s);
        c.sprite = s;
      }
    });

    /* 정착지 링 */
    const ringGeo = new THREE.TorusGeometry(1.5, 0.075, 8, 30);
    checkpoints.forEach((cp, i) => {
      if (i === 0) return;
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x50607a }));
      mesh.position.set(cp.x, cp.y + 1.6, cp.z);
      mesh.rotation.x = Math.PI / 2;
      scene.add(mesh);
      cp.ring = mesh;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0x3ff0ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      s.scale.set(7, 7, 1);
      s.position.set(cp.x, cp.y + 1.6, cp.z);
      scene.add(s);
      cp.glow = s;
    });

    /* 상승 기류 비주얼 */
    const upMats = [];
    updrafts.forEach((u) => {
      const h = u.y1 - u.y0;
      const g = new THREE.CylinderGeometry(u.r, u.r * 0.75, h, 18, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x8fffe0, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
      });
      const m = new THREE.Mesh(g, mat);
      m.position.set(u.x, (u.y0 + u.y1) / 2, u.z);
      scene.add(m);
      upMats.push(mat);
      // 상승 입자
      const N = 60;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = rnd() * Math.PI * 2, r = rnd() * u.r * 0.9;
        pos[i * 3] = u.x + Math.cos(a) * r;
        pos[i * 3 + 1] = u.y0 + rnd() * h;
        pos[i * 3 + 2] = u.z + Math.sin(a) * r;
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(pg, new THREE.PointsMaterial({
        color: 0xd7fff2, size: 0.18, map: glowTex, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      scene.add(pts);
      u.pts = pts; u.h = h;
    });

    /* ---------- 배경 구조물 / 네온 사인 ---------- */
    const bgCount = 90;
    const iBg = new THREE.InstancedMesh(boxGeo, new THREE.MeshToonMaterial({ color: 0x161a26, gradientMap: RAMP }), bgCount);
    iBg.frustumCulled = false;
    for (let i = 0; i < bgCount; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd.range(40, 105);
      const y = rnd.range(-30, GOAL_Y + 40);
      const w = rnd.range(6, 22), h = rnd.range(14, 70), d = rnd.range(6, 22);
      mtx.makeScale(w, h, d);
      mtx.setPosition(Math.cos(a) * r, y, Math.sin(a) * r);
      iBg.setMatrixAt(i, mtx);
    }
    iBg.instanceMatrix.needsUpdate = true;
    scene.add(iBg);

    const signCount = 70;
    const iSign = new THREE.InstancedMesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), signCount);
    iSign.frustumCulled = false;
    for (let i = 0; i < signCount; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd.range(34, 92);
      const y = rnd.range(-10, GOAL_Y + 20);
      const vert = rnd.chance(0.45);
      mtx.makeScale(vert ? rnd.range(0.4, 1.0) : rnd.range(3, 9), vert ? rnd.range(4, 13) : rnd.range(0.4, 1.1), 0.4);
      mtx.setPosition(Math.cos(a) * r, y, Math.sin(a) * r);
      iSign.setMatrixAt(i, mtx);
      col.setHSL(rnd.pick([0.02, 0.09, 0.5, 0.55, 0.86, 0.94]), 0.95, 0.6);
      iSign.setColorAt(i, col);
    }
    iSign.instanceMatrix.needsUpdate = true;
    if (iSign.instanceColor) iSign.instanceColor.needsUpdate = true;
    scene.add(iSign);

    /* 공중 먼지 */
    const DUST = 1400;
    const dpos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      const a = rnd() * Math.PI * 2, r = rnd.range(2, 42);
      dpos[i * 3] = Math.cos(a) * r;
      dpos[i * 3 + 1] = rnd.range(-10, GOAL_Y + 30);
      dpos[i * 3 + 2] = Math.sin(a) * r;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    const dust = new THREE.Points(dg, new THREE.PointsMaterial({
      color: 0x9fd2ff, size: 0.15, map: glowTex, transparent: true,
      opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    dust.frustumCulled = false;
    scene.add(dust);

    /* 정점 빛기둥 */
    const beamGeo = new THREE.CylinderGeometry(4.2, 1.4, 60, 22, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd23f, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(goalPos.x, topY + 30, goalPos.z);
    scene.add(beam);
    let beamBoost = 0;   // 골인 연출용

    /* ---------- 브로드페이즈 버킷 ---------- */
    const bins = new Map();
    function binOf(y) { return Math.floor(y / BIN); }
    colliders.forEach((c) => {
      // 이동 발판은 이동 범위를 모두 커버해야 한다
      let lo = c.miny, hi = c.maxy;
      if (c.mover && c.mover.type === 'lin' && c.mover.ay) {
        lo -= c.mover.amp; hi += c.mover.amp;
      }
      for (let b = binOf(lo) - 1; b <= binOf(hi) + 1; b++) {
        let arr = bins.get(b);
        if (!arr) bins.set(b, (arr = []));
        arr.push(c);
      }
    });

    const queryBuf = [];
    function query(minY, maxY) {
      queryBuf.length = 0;
      const b0 = binOf(minY), b1 = binOf(maxY);
      for (let b = b0; b <= b1; b++) {
        const arr = bins.get(b);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (c._q === queryId) continue;
          c._q = queryId;
          queryBuf.push(c);
        }
      }
      queryId++;
      return queryBuf;
    }
    let queryId = 1;

    /* ---------- 프레임 업데이트 ---------- */
    const tmpV = new THREE.Vector3();
    function update(dt, time) {
      for (let i = 0; i < movers.length; i++) {
        const c = movers[i];
        const mv = c.mover;
        const px = c.cx, py = c.cy, pz = c.cz;
        if (mv.type === 'lin') {
          const s = Math.sin(time * mv.spd * Math.PI * 2 + mv.ph) * mv.amp;
          c.cx = mv.bx + mv.ax * s;
          c.cy = mv.by + mv.ay * s;
          c.cz = mv.bz + mv.az * s;
        } else {
          const a = time * mv.spd * Math.PI * 2 + mv.ph;
          c.cx = mv.cx + Math.cos(a) * mv.r;
          c.cy = mv.cy;
          c.cz = mv.cz + Math.sin(a) * mv.r;
        }
        c.dx = c.cx - px; c.dy = c.cy - py; c.dz = c.cz - pz;
        if (dt > 1e-5) { c.vx = c.dx / dt; c.vy = c.dy / dt; c.vz = c.dz / dt; }
        refresh(c);
        c.mesh.position.set(c.cx, c.cy, c.cz);
      }
      for (let i = 0; i < bounces.length; i++) {
        const c = bounces[i];
        const p = 0.55 + Math.sin(time * 5 + i) * 0.25;
        if (c.sprite) c.sprite.material.opacity = p;
        c.mesh.scale.y = c.hy * 2 * (1 + Math.sin(time * 5 + i) * 0.12);
      }
      for (let i = 0; i < updrafts.length; i++) {
        const u = updrafts[i];
        const arr = u.pts.geometry.attributes.position.array;
        for (let j = 1; j < arr.length; j += 3) {
          arr[j] += dt * 7;
          if (arr[j] > u.y1) arr[j] = u.y0;
        }
        u.pts.geometry.attributes.position.needsUpdate = true;
      }
      upMats.forEach((m, i) => { m.opacity = 0.12 + Math.sin(time * 3 + i) * 0.05; });
      checkpoints.forEach((cp) => {
        if (!cp.ring) return;
        cp.ring.rotation.z += dt * (cp.active ? 1.6 : 0.3);
        if (cp.active) {
          cp.ring.material.color.setHSL(0.5, 1, 0.6 + Math.sin(time * 4) * 0.12);
          cp.glow.material.opacity = 0.35 + Math.sin(time * 4) * 0.12;
        }
      });
      beamMat.opacity = (0.09 + Math.sin(time * 1.5) * 0.03) * (1 + beamBoost * 7);
      if (beamBoost > 0) {
        const gm = goal.mesh.material;
        gm.emissive.setHSL(0.13, 1, 0.18 + Math.sin(time * 7) * 0.14 * beamBoost);
      }
      void tmpV;
    }

    return {
      colliders: colliders,
      path: path,
      movers: movers,
      updrafts: updrafts,
      checkpoints: checkpoints,
      goal: goal,
      approach: approach,
      goalPos: goalPos,
      setBeamBoost(v) { beamBoost = v; },
      topY: topY,
      goalY: GOAL_Y,
      start: new THREE.Vector3(0, 0.62, 0),
      query: query,
      update: update
    };
  };
})();
