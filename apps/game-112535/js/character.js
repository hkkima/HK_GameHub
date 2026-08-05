/* ONLY UP : ZHAO — 플레이어 캐릭터 "자오"
 *
 * 4등신 분홍 토끼 수인. 외부 3D 애셋 없이 프리미티브만으로 조립했다.
 *   · 분홍 헤어 + X스크류 사이드번 + 길게 흐르는 트윈 브레이드(관성 시뮬)
 *   · 큰 토끼 귀 (스프링으로 통통 튄다)
 *   · 헤드폰 / 민트 소매 / 흰-주황 후드 재킷 / 검정 에이프런
 *   · 흰 털 짐승다리 + 큼직한 발바닥
 *   · 등에 멘 대형 클리버 + 토끼 인형 참(흔들린다)
 *
 * 색은 아래 PALETTE 한 곳에서 전부 조절된다.
 */
(function () {
  'use strict';
  const OU = window.OU;
  const M = OU.M;
  const V3 = THREE.Vector3;

  const PALETTE = {
    skin: 0xfff1e6,
    blush: 0xf7a9ac,
    hair: 0xf8c8d1,      // 연분홍
    hairShade: 0xe7a2b1,
    hairLight: 0xfde3e8,
    ear: 0xf9cfd7,
    earIn: 0xef97a6,
    fur: 0xfdf4e8,       // 다리 털
    furShade: 0xe8dbc9,
    jacket: 0xfff6ee,    // 흰 후드 재킷
    orange: 0xf2762e,
    orangeDk: 0xcf5a17,
    shirt: 0x4ac9c9,     // 민트 소매
    shirtCuff: 0xe9f7f7,
    apron: 0x2b2b33,     // 검정 에이프런
    belt: 0x1b1b21,
    metal: 0xbcc3cf,
    metalDk: 0x7c828e,
    handle: 0xc2392e,
    gold: 0xf5c542,
    eye: 0xe1495b,
    white: 0xffffff,
    dark: 0x2a232a
  };

  const RAMP = OU.gradientMap([90, 150, 210, 255]);

  function toon(color, opts) {
    return new THREE.MeshToonMaterial(Object.assign({ color: color, gradientMap: RAMP }, opts || {}));
  }
  const MAT = {
    skin: toon(PALETTE.skin),
    blush: toon(PALETTE.blush),
    hair: toon(PALETTE.hair),
    hairShade: toon(PALETTE.hairShade),
    hairLight: toon(PALETTE.hairLight),
    ear: toon(PALETTE.ear),
    earIn: toon(PALETTE.earIn),
    fur: toon(PALETTE.fur),
    furShade: toon(PALETTE.furShade),
    jacket: toon(PALETTE.jacket),
    orange: toon(PALETTE.orange),
    orangeDk: toon(PALETTE.orangeDk),
    shirt: toon(PALETTE.shirt),
    cuff: toon(PALETTE.shirtCuff),
    apron: toon(PALETTE.apron),
    belt: toon(PALETTE.belt),
    metal: toon(PALETTE.metal),
    metalDk: toon(PALETTE.metalDk),
    handle: toon(PALETTE.handle),
    gold: toon(PALETTE.gold),
    white: toon(PALETTE.white),
    dark: toon(PALETTE.dark),
    eye: new THREE.MeshBasicMaterial({ color: PALETTE.eye }),
    eyeW: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    outline: new THREE.MeshBasicMaterial({ color: 0x3a2630, side: THREE.BackSide })
  };

  const GEO = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(1, 18, 14),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1),
    cylZ: (function () { const g = new THREE.CylinderGeometry(1, 1, 1, 16, 1); g.rotateX(Math.PI / 2); return g; })(),
    cone: new THREE.ConeGeometry(1, 1, 14)
  };

  /* ---------- 조립 헬퍼 ---------- */
  function put(parent, geo, mat, pos, scale, outline) {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    m.castShadow = true;
    parent.add(m);
    if (outline) {
      const o = new THREE.Mesh(geo, MAT.outline);
      o.scale.setScalar(1 + outline);
      m.add(o);
    }
    return m;
  }
  function bx(parent, mat, w, h, d, x, y, z, outline) {
    return put(parent, GEO.box, mat, [x, y, z], [w, h, d], outline);
  }
  function sp(parent, mat, rx, ry, rz, x, y, z, outline) {
    return put(parent, GEO.sphere, mat, [x, y, z], [rx, ry, rz], outline);
  }
  function group(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }
  function limbMesh(parent, mat, r, len, y, outline) {
    const geo = new THREE.CapsuleGeometry(r, len, 4, 12);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    parent.add(m);
    if (outline) {
      const o = new THREE.Mesh(geo, MAT.outline);
      o.scale.setScalar(1 + outline);
      m.add(o);
    }
    return m;
  }

  /* ---------- 관성 체인 (브레이드 / 인형 참) ---------- */
  function Chain(container, anchor, localAnchor, opts) {
    const n = opts.segs;
    const L = opts.len;
    const pts = [], prev = [];
    const restDir = opts.restDir.clone().normalize();
    const tmp = new V3(), acc = new V3(), target = new V3();
    const worldAnchor = new V3();

    anchor.updateWorldMatrix(true, false);
    worldAnchor.copy(localAnchor).applyMatrix4(anchor.matrixWorld);
    for (let i = 0; i < n + 1; i++) {
      const p = worldAnchor.clone().add(restDir.clone().multiplyScalar(L * i));
      pts.push(p);
      prev.push(p.clone());
    }

    const meshes = [];
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const r = M.lerp(opts.r0, opts.r1, t);
      let geo;
      if (opts.braid) {
        // 땋은 머리: 살짝 볼록한 마디
        geo = new THREE.SphereGeometry(1, 12, 9);
        geo.scale(r, L * 0.62, r * 0.92);
      } else if (opts.flat) {
        geo = new THREE.BoxGeometry(r * 2, L * 1.06, r * 0.62);
      } else {
        geo = new THREE.CapsuleGeometry(r, L * 0.9, 3, 9);
      }
      const m = new THREE.Mesh(geo, opts.mat);
      m.castShadow = true;
      container.add(m);
      meshes.push(m);
    }

    const dir = new V3(), up = new V3(0, 1, 0), q = new THREE.Quaternion();
    const restWorld = new V3();

    return {
      meshes: meshes,
      tip: meshes[meshes.length - 1],
      tipOffset: L * 0.5,
      update(dt, extraForce) {
        anchor.updateWorldMatrix(true, false);
        worldAnchor.copy(localAnchor).applyMatrix4(anchor.matrixWorld);
        restWorld.copy(restDir).transformDirection(anchor.matrixWorld);

        pts[0].copy(worldAnchor);
        prev[0].copy(worldAnchor);

        const damp = opts.damp !== undefined ? opts.damp : 0.88;
        const stiff = opts.stiff !== undefined ? opts.stiff : 9;
        const g = opts.gravity !== undefined ? opts.gravity : -14;
        const kRest = 1 - Math.exp(-stiff * dt);

        for (let i = 1; i < pts.length; i++) {
          const p = pts[i];
          tmp.copy(p).sub(prev[i]).multiplyScalar(damp);   // 관성
          prev[i].copy(p);
          acc.set(0, g, 0);
          if (extraForce) acc.add(extraForce);
          p.add(tmp).addScaledVector(acc, dt * dt);
          target.copy(worldAnchor).addScaledVector(restWorld, L * i);
          p.lerp(target, kRest);
        }
        for (let k = 0; k < 3; k++) {
          for (let i = 1; i < pts.length; i++) {
            dir.copy(pts[i]).sub(pts[i - 1]);
            const d = dir.length() || 1e-5;
            dir.multiplyScalar((d - L) / d);
            pts[i].sub(dir);
          }
        }
        for (let i = 0; i < meshes.length; i++) {
          const a = pts[i], b = pts[i + 1];
          const m = meshes[i];
          m.position.copy(a).add(b).multiplyScalar(0.5);
          container.worldToLocal(m.position);
          dir.copy(b).sub(a).normalize();
          q.setFromUnitVectors(up, dir);
          m.quaternion.copy(q);
        }
      },
      teleport() {
        anchor.updateWorldMatrix(true, false);
        worldAnchor.copy(localAnchor).applyMatrix4(anchor.matrixWorld);
        restWorld.copy(restDir).transformDirection(anchor.matrixWorld);
        for (let i = 0; i < pts.length; i++) {
          pts[i].copy(worldAnchor).addScaledVector(restWorld, L * i);
          prev[i].copy(pts[i]);
        }
      }
    };
  }

  /* ================= 캐릭터 생성 ================= */
  OU.createZhao = function (scene) {
    const HEIGHT = 1.44;                     // 귀 제외 전신 높이 (4등신)
    const root = new THREE.Group();          // 발바닥 기준(y=0), +Z 정면
    scene.add(root);
    const dress = new THREE.Group();         // 체인 메시(월드 좌표)
    scene.add(dress);

    const body = group(root, 0, 0, 0);       // 스쿼시/스트레치
    const hips = group(body, 0, 0.62, 0);
    const spine = group(hips, 0, 0.06, 0);
    const chest = spine;

    /* ---------- 몸통 ---------- */
    bx(hips, MAT.apron, 0.34, 0.20, 0.24, 0, -0.03, 0, 0.05);           // 반바지
    sp(hips, MAT.fur, 0.095, 0.085, 0.085, 0, -0.06, -0.15, 0.06);      // 토끼 꼬리

    // 민트 이너 (앞은 에이프런이 덮고 목·어깨 쪽만 보인다)
    bx(chest, MAT.shirt, 0.30, 0.34, 0.245, 0, 0.17, 0, 0.05);
    bx(chest, MAT.orange, 0.24, 0.055, 0.255, 0, 0.315, 0.005);           // 주황 카라
    // 흰 재킷 (앞은 열려 있고 뒤·옆을 덮는다)
    bx(chest, MAT.jacket, 0.40, 0.34, 0.10, 0, 0.17, -0.10, 0.05);      // 등판
    bx(chest, MAT.jacket, 0.075, 0.34, 0.26, 0.175, 0.17, -0.01, 0.05); // 좌 앞섶
    bx(chest, MAT.jacket, 0.075, 0.34, 0.26, -0.175, 0.17, -0.01, 0.05);
    bx(chest, MAT.orange, 0.075, 0.075, 0.27, 0.176, 0.02, -0.01);      // 주황 트림
    bx(chest, MAT.orange, 0.075, 0.075, 0.27, -0.176, 0.02, -0.01);
    // 후드
    sp(chest, MAT.jacket, 0.17, 0.13, 0.13, 0, 0.35, -0.11, 0.05);
    bx(chest, MAT.orange, 0.26, 0.055, 0.10, 0, 0.30, -0.14);
    // 검정 에이프런 + 토끼 로고
    bx(chest, MAT.apron, 0.30, 0.30, 0.045, 0, 0.06, 0.13, 0.05);
    bx(chest, MAT.white, 0.075, 0.10, 0.02, 0, 0.10, 0.155);
    bx(chest, MAT.apron, 0.022, 0.05, 0.012, -0.02, 0.155, 0.167);
    bx(chest, MAT.apron, 0.022, 0.05, 0.012, 0.02, 0.155, 0.167);
    // 벨트 + 주황 끈
    bx(chest, MAT.belt, 0.37, 0.06, 0.27, 0, -0.045, 0, 0.04);
    bx(chest, MAT.gold, 0.06, 0.05, 0.03, 0, -0.045, 0.145);
    bx(chest, MAT.orange, 0.035, 0.16, 0.035, 0.10, 0.05, 0.15);
    bx(chest, MAT.orange, 0.035, 0.12, 0.035, -0.11, 0.07, 0.15);

    /* ---------- 머리 ---------- */
    const neck = group(chest, 0, 0.335, 0);
    bx(neck, MAT.skin, 0.09, 0.05, 0.09, 0, 0.01, 0);
    const head = group(neck, 0, 0.04, 0);

    sp(head, MAT.skin, 0.175, 0.185, 0.170, 0, 0.16, 0.01, 0.045);      // 큰 머리
    sp(head, MAT.hair, 0.186, 0.190, 0.176, 0, 0.185, -0.030, 0.04);    // 헤어 캡
    bx(head, MAT.hair, 0.33, 0.085, 0.10, 0, 0.255, 0.105, 0.05);       // 앞머리
    bx(head, MAT.hairLight, 0.10, 0.06, 0.03, -0.055, 0.275, 0.155);
    bx(head, MAT.hair, 0.075, 0.20, 0.09, 0.163, 0.135, 0.06, 0.05);    // 사이드 머리
    bx(head, MAT.hair, 0.075, 0.20, 0.09, -0.163, 0.135, 0.06, 0.05);
    sp(head, MAT.hair, 0.075, 0.10, 0.075, 0, 0.315, -0.02, 0.05);      // 정수리 애호

    // 눈 (윙크한 오른쪽 + 크게 뜬 왼쪽)
    bx(head, MAT.eyeW, 0.072, 0.082, 0.02, 0.078, 0.145, 0.163);
    bx(head, MAT.eye, 0.050, 0.058, 0.022, 0.080, 0.140, 0.168);
    bx(head, MAT.white, 0.020, 0.022, 0.024, 0.093, 0.160, 0.170);
    bx(head, MAT.dark, 0.082, 0.020, 0.022, 0.078, 0.192, 0.166);       // 눈매
    bx(head, MAT.dark, 0.072, 0.018, 0.022, -0.080, 0.150, 0.166);      // 윙크
    bx(head, MAT.orange, 0.035, 0.045, 0.02, -0.128, 0.185, 0.155);     // 눈가 마킹
    // 볼터치 + 입
    bx(head, MAT.blush, 0.055, 0.028, 0.02, 0.135, 0.095, 0.148);
    bx(head, MAT.blush, 0.055, 0.028, 0.02, -0.135, 0.095, 0.148);
    bx(head, MAT.dark, 0.030, 0.014, 0.02, 0.015, 0.075, 0.172);

    /* 사이드번 + X 스크류 핀 */
    function bun(side) {
      const g = group(head, 0.20 * side, 0.275, -0.02);
      sp(g, MAT.hair, 0.085, 0.085, 0.085, 0, 0, 0, 0.05);
      sp(g, MAT.hairShade, 0.05, 0.05, 0.05, -0.03 * side, -0.03, 0.04);
      // 회색 스크류 핀
      put(g, GEO.cylZ, MAT.metal, [0.055 * side, 0.02, 0.075], [0.042, 0.06, 0.042], 0.05);
      bx(g, MAT.metalDk, 0.05, 0.012, 0.012, 0.055 * side, 0.02, 0.108);
      bx(g, MAT.metalDk, 0.012, 0.05, 0.012, 0.055 * side, 0.02, 0.108);
      // 주황 방울
      sp(g, MAT.orange, 0.036, 0.036, 0.036, -0.02 * side, 0.075, -0.06);
      sp(g, MAT.orangeDk, 0.026, 0.026, 0.026, 0.05 * side, 0.06, -0.07);
      return g;
    }
    bun(1); bun(-1);

    /* 헤드폰 */
    function can(side) {
      const g = group(head, 0.196 * side, 0.135, -0.03);
      put(g, GEO.cylZ, MAT.dark, [0.035 * side, 0, 0], [0.088, 0.052, 0.088], 0.05);
      put(g, GEO.cylZ, MAT.orange, [0.062 * side, 0, 0], [0.062, 0.022, 0.062]);
      put(g, GEO.cylZ, MAT.metal, [0.075 * side, 0, 0], [0.030, 0.014, 0.030]);
      bx(g, MAT.metalDk, 0.016, 0.10, 0.016, 0.080 * side, 0, 0);
      bx(g, MAT.metalDk, 0.016, 0.016, 0.10, 0.080 * side, 0, 0);
      return g;
    }
    can(1); can(-1);
    bx(head, MAT.metalDk, 0.40, 0.028, 0.05, 0, 0.315, -0.055);          // 헤드밴드

    /* 토끼 귀 (스프링으로 흔들린다) */
    function makeEar(side) {
      const g = group(head, 0.088 * side, 0.30, -0.025);
      g.rotation.z = -0.22 * side;
      const mid = group(g, 0, 0.165, 0);
      mid.rotation.x = 0.22;                                              // 끝이 살짝 뒤로 휜다
      // 아래쪽 귀
      put(g, GEO.box, MAT.ear, [0, 0.085, 0], [0.115, 0.19, 0.08], 0.05);
      put(g, GEO.box, MAT.earIn, [0, 0.085, 0.034], [0.062, 0.155, 0.03]);
      // 위쪽 귀
      put(mid, GEO.box, MAT.ear, [0, 0.075, 0], [0.10, 0.165, 0.072], 0.05);
      put(mid, GEO.box, MAT.earIn, [0, 0.065, 0.031], [0.052, 0.125, 0.028]);
      put(mid, GEO.sphere, MAT.ear, [0, 0.163, 0], [0.05, 0.045, 0.036], 0.05);
      return { base: g, mid: mid };
    }
    const earL = makeEar(1), earR = makeEar(-1);

    /* ---------- 팔 (짧고 통통) ---------- */
    function makeArm(side) {
      const sh = group(chest, 0.198 * side, 0.275, 0);
      bx(sh, MAT.jacket, 0.145, 0.115, 0.175, 0.018 * side, 0.02, 0, 0.05); // 어깨
      bx(sh, MAT.orange, 0.145, 0.03, 0.176, 0.018 * side, -0.045, 0);      // 소매 트림
      limbMesh(sh, MAT.shirt, 0.058, 0.11, -0.10, 0.05);
      const el = group(sh, 0, -0.185, 0);
      limbMesh(el, MAT.shirt, 0.054, 0.09, -0.08, 0.05);
      bx(el, MAT.cuff, 0.10, 0.045, 0.10, 0, -0.155, 0);                   // 흰 커프스
      const wr = group(el, 0, -0.185, 0);
      sp(wr, MAT.fur, 0.062, 0.058, 0.058, 0, -0.045, 0.005, 0.06);        // 손(털장갑)
      return { sh: sh, el: el, wr: wr };
    }
    const armL = makeArm(1), armR = makeArm(-1);

    /* ---------- 다리 (짐승다리 + 큰 발) ---------- */
    function makeLeg(side) {
      const hp = group(hips, 0.105 * side, -0.06, 0);
      limbMesh(hp, MAT.fur, 0.088, 0.14, -0.11, 0.05);
      const kn = group(hp, 0, -0.24, 0);
      limbMesh(kn, MAT.fur, 0.072, 0.11, -0.08, 0.05);
      bx(kn, MAT.belt, 0.155, 0.035, 0.155, 0, -0.10, 0);                  // 검정 스트랩
      bx(kn, MAT.belt, 0.155, 0.035, 0.155, 0, -0.155, 0);
      const an = group(kn, 0, -0.20, 0);
      bx(an, MAT.fur, 0.155, 0.085, 0.26, 0, -0.035, 0.055, 0.05);         // 발바닥
      sp(an, MAT.fur, 0.062, 0.045, 0.05, 0.045, -0.045, 0.165, 0.06);     // 발가락
      sp(an, MAT.fur, 0.062, 0.045, 0.05, -0.045, -0.045, 0.165, 0.06);
      sp(an, MAT.furShade, 0.055, 0.03, 0.075, 0, -0.072, 0.075);
      return { hp: hp, kn: kn, an: an };
    }
    const legL = makeLeg(1), legR = makeLeg(-1);

    /* ---------- 등에 멘 대형 클리버 ---------- */
    const weapon = group(chest, 0.03, 0.10, -0.185);
    weapon.rotation.set(0.20, 0.14, 0.72);
    bx(weapon, MAT.handle, 0.045, 0.52, 0.045, 0, 0, 0, 0.05);             // 붉은 손잡이
    bx(weapon, MAT.gold, 0.055, 0.035, 0.055, 0, 0.20, 0);
    bx(weapon, MAT.belt, 0.05, 0.05, 0.05, 0, -0.24, 0);
    // 은색 날 (큰 식칼 형태)
    const blade = group(weapon, 0, 0.29, 0);
    bx(blade, MAT.metal, 0.30, 0.34, 0.035, 0.12, 0.06, 0, 0.03);
    bx(blade, MAT.metal, 0.16, 0.20, 0.035, -0.05, 0.00, 0, 0.03);
    put(blade, GEO.cone, MAT.metal, [0.30, 0.24, 0], [0.13, 0.20, 0.035], 0.03);
    bx(blade, MAT.metalDk, 0.30, 0.05, 0.042, 0.12, -0.10, 0);
    bx(blade, MAT.gold, 0.07, 0.07, 0.05, -0.10, -0.13, 0);
    // 손잡이 가드
    bx(weapon, MAT.metalDk, 0.14, 0.05, 0.05, 0.05, 0.13, 0);

    /* ---------- 체인: 트윈 브레이드 + 인형 참 ---------- */
    const braidL = Chain(dress, head, new V3(0.145, 0.185, -0.12), {
      segs: 6, len: 0.10, r0: 0.052, r1: 0.026, mat: MAT.hair, braid: true,
      restDir: new V3(0.20, -0.72, -0.66), damp: 0.9, stiff: 6.5, gravity: -13
    });
    const braidR = Chain(dress, head, new V3(-0.145, 0.185, -0.12), {
      segs: 6, len: 0.10, r0: 0.052, r1: 0.026, mat: MAT.hair, braid: true,
      restDir: new V3(-0.20, -0.72, -0.66), damp: 0.9, stiff: 6.5, gravity: -13
    });
    const charm = Chain(dress, weapon, new V3(0.0, -0.26, 0.0), {
      segs: 2, len: 0.075, r0: 0.012, r1: 0.010, mat: MAT.handle,
      restDir: new V3(0, -1, 0), damp: 0.86, stiff: 5, gravity: -20
    });
    const chains = [braidL, braidR, charm];

    /* 브레이드 끝 방울 + 인형 머리 (체인 마지막 마디에 부착) */
    function braidTip(chain, side) {
      const t = chain.tip, off = chain.tipOffset;
      sp(t, MAT.orange, 0.042, 0.042, 0.042, 0, off + 0.02, 0);
      sp(t, MAT.orangeDk, 0.030, 0.030, 0.030, 0.035 * side, off + 0.055, 0.01);
      sp(t, MAT.orange, 0.026, 0.026, 0.026, -0.03 * side, off + 0.06, -0.02);
      sp(t, MAT.hairLight, 0.036, 0.055, 0.036, 0, off + 0.10, 0);
    }
    braidTip(braidL, 1); braidTip(braidR, -1);
    (function charmTip() {
      const t = charm.tip, off = charm.tipOffset;
      sp(t, MAT.white, 0.055, 0.050, 0.048, 0, off + 0.045, 0, 0.06);       // 토끼 인형 머리
      bx(t, MAT.white, 0.020, 0.055, 0.018, 0.022, off + 0.10, -0.01);      // 귀
      bx(t, MAT.white, 0.020, 0.055, 0.018, -0.022, off + 0.10, -0.01);
      bx(t, MAT.dark, 0.020, 0.006, 0.006, 0.022, off + 0.05, 0.045);       // X 눈
      bx(t, MAT.dark, 0.006, 0.020, 0.006, 0.022, off + 0.05, 0.045);
      bx(t, MAT.dark, 0.020, 0.006, 0.006, -0.022, off + 0.05, 0.045);
      bx(t, MAT.dark, 0.006, 0.020, 0.006, -0.022, off + 0.05, 0.045);
      bx(t, MAT.gold, 0.030, 0.022, 0.022, 0, off + 0.02, 0.04);            // 주황 부리? 리본
    })();

    /* ---------- 애니메이션 상태 ---------- */
    const cur = {
      lhp: 0, lkn: 0, lan: 0, rhp: 0, rkn: 0, ran: 0,
      lsh: 0, lel: 0, lshz: 0, rsh: 0, rel: 0, rshz: 0,
      spine: 0, spineZ: 0, hipsY: 0, headX: 0, headY: 0, headZ: 0, hipY: 0
    };
    const tgt = Object.assign({}, cur);
    const ear = { a: 0, v: 0, a2: 0, v2: 0 };

    let phase = 0, t = 0, yaw = 0, prevPhase = 0;
    let squash = 1;
    const force = new V3();

    const api = {
      root: root,
      height: HEIGHT,
      yaw: 0,
      onStep: null,
      victory: false,        // 골인 연출용 만세 포즈

      reset(pos, faceYaw) {
        root.position.copy(pos);
        yaw = api.yaw = faceYaw || 0;
        root.rotation.y = yaw;
        phase = 0; squash = 1;
        ear.a = ear.v = ear.a2 = ear.v2 = 0;
        root.updateWorldMatrix(true, true);
        chains.forEach((c) => c.teleport());
      },

      /** s = { speed, grounded, vy, moveDir:{x,z}, landImpact } */
      update(dt, s) {
        t += dt;
        const spd = s.speed;
        const moving = spd > 0.4 && s.grounded;
        const run = M.clamp(spd / 7.2, 0, 1.35);

        if (s.moveDir && (s.moveDir.x || s.moveDir.z)) {
          const want = Math.atan2(s.moveDir.x, s.moveDir.z);
          yaw = M.dampAngle(yaw, want, s.grounded ? 15 : 7, dt);
        }
        api.yaw = yaw;
        root.rotation.y = yaw;

        /* 짧은 다리라 걸음이 빠르다 */
        if (moving) {
          phase += spd * 1.95 * dt * Math.PI;
          if (api.onStep) {
            if (Math.floor(phase / Math.PI) !== Math.floor(prevPhase / Math.PI)) api.onStep(run);
          }
          prevPhase = phase;
        }

        const hop = Math.abs(Math.sin(t * 5.2));      // 만세 점프용

        if (api.victory) {
          /* 정점 도달: 양팔 번쩍 + 제자리 콩콩 */
          tgt.lhp = 0.06; tgt.rhp = 0.06;
          tgt.lkn = 0.22 + hop * 0.4; tgt.rkn = 0.22 + hop * 0.4;
          tgt.lan = -0.22 - hop * 0.25; tgt.ran = -0.22 - hop * 0.25;
          tgt.lsh = -2.78; tgt.rsh = -2.78;
          tgt.lel = -0.16; tgt.rel = -0.16;
          tgt.lshz = 0.55; tgt.rshz = -0.55;
          tgt.spine = -0.13; tgt.spineZ = Math.sin(t * 2.6) * 0.07;
          tgt.hipsY = Math.sin(t * 2.6) * 0.13;
          tgt.headX = -0.22;
          tgt.headY = Math.sin(t * 2.0) * 0.22;
          tgt.headZ = Math.sin(t * 1.6) * 0.11;
          tgt.hipY = hop * 0.05;
          body.position.y = hop * 0.15;
        } else if (!s.grounded) {
          body.position.y = M.damp(body.position.y, 0, 10, dt);
          const rising = s.vy;
          if (rising > 0.05) {
            // 점프: 무릎을 뒤로 접고 팔 번쩍
            tgt.lhp = -0.7; tgt.rhp = 0.25;
            tgt.lkn = 1.35; tgt.rkn = 0.6;
            tgt.lan = 0.3; tgt.ran = 0.15;
            tgt.lsh = -2.3; tgt.rsh = -2.0;
            tgt.lel = -0.35; tgt.rel = -0.5;
            tgt.lshz = 0.45; tgt.rshz = -0.45;
            tgt.spine = -0.16; tgt.spineZ = 0;
            tgt.headX = -0.14; tgt.headZ = 0;
          } else {
            // 낙하: 팔다리 허우적
            const fl = Math.sin(t * 9) * 0.2;
            tgt.lhp = -0.45 + fl; tgt.rhp = 0.4 - fl;
            tgt.lkn = 0.7; tgt.rkn = 0.35;
            tgt.lan = 0.25; tgt.ran = 0.2;
            tgt.lsh = -2.6 + fl * 0.7; tgt.rsh = -2.5 - fl * 0.7;
            tgt.lel = -0.3; tgt.rel = -0.35;
            tgt.lshz = 0.95; tgt.rshz = -0.95;
            tgt.spine = 0.2;
            tgt.headX = 0.2; tgt.headZ = 0;
          }
          tgt.hipY = 0; tgt.hipsY = 0;
        } else if (moving) {
          body.position.y = M.damp(body.position.y, 0, 10, dt);
          const sw = 0.6 * run + 0.14;
          const kb = 0.85 * run + 0.25;
          const sa = Math.sin(phase), ca = Math.cos(phase);
          tgt.lhp = -sa * sw; tgt.rhp = sa * sw;
          // 무릎은 항상 뒤(-Z)로 접힌다
          tgt.lkn = Math.max(0, ca) * kb + 0.14;
          tgt.rkn = Math.max(0, -ca) * kb + 0.14;
          tgt.lan = -sa * 0.2 + 0.1; tgt.ran = sa * 0.2 + 0.1;
          tgt.lsh = sa * (0.72 * run + 0.12) - 0.1 * run;
          tgt.rsh = -sa * (0.72 * run + 0.12) - 0.1 * run;
          tgt.lel = -0.4 - Math.max(0, sa) * 0.6 * run;
          tgt.rel = -0.4 - Math.max(0, -sa) * 0.6 * run;
          tgt.lshz = 0.2 + 0.12 * run; tgt.rshz = -0.2 - 0.12 * run;
          tgt.spine = -0.05 - 0.14 * run;
          tgt.spineZ = -ca * 0.06;
          tgt.hipsY = sa * 0.11;
          tgt.headX = 0.03 + 0.08 * run;
          tgt.headY = 0; tgt.headZ = ca * 0.05;
          tgt.hipY = Math.abs(sa) * 0.045 * run;
        } else {
          // 대기: 호흡 + 갸웃
          body.position.y = M.damp(body.position.y, 0, 10, dt);
          const br = Math.sin(t * 2.0);
          tgt.lhp = 0.05; tgt.rhp = -0.03;
          tgt.lkn = 0.16; tgt.rkn = 0.22;
          tgt.lan = -0.20; tgt.ran = -0.19;   // 발바닥이 바닥과 평평하도록 무릎각을 상쇄
          tgt.lsh = 0.03 + br * 0.04; tgt.rsh = 0.03 - br * 0.04;
          tgt.lel = -0.42; tgt.rel = -0.36;
          tgt.lshz = 0.34 + br * 0.035; tgt.rshz = -0.34 - br * 0.035;
          tgt.spine = 0.02 + br * 0.025;
          tgt.spineZ = Math.sin(t * 0.9) * 0.035;
          tgt.hipsY = Math.sin(t * 0.9) * 0.06;
          tgt.headX = -0.03 + br * 0.035;
          tgt.headY = Math.sin(t * 0.55) * 0.26;
          tgt.headZ = Math.sin(t * 0.42) * 0.09;
          tgt.hipY = br * 0.014;
        }

        const rate = s.grounded ? 19 : 12;
        for (const k in cur) cur[k] = M.damp(cur[k], tgt[k], rate, dt);

        legL.hp.rotation.x = cur.lhp; legR.hp.rotation.x = cur.rhp;
        legL.kn.rotation.x = cur.lkn; legR.kn.rotation.x = cur.rkn;
        legL.an.rotation.x = cur.lan; legR.an.rotation.x = cur.ran;
        armL.sh.rotation.x = cur.lsh; armR.sh.rotation.x = cur.rsh;
        armL.sh.rotation.z = cur.lshz; armR.sh.rotation.z = cur.rshz;
        armL.el.rotation.x = cur.lel; armR.el.rotation.x = cur.rel;
        spine.rotation.x = cur.spine;
        spine.rotation.z = cur.spineZ;
        hips.rotation.y = cur.hipsY;
        head.rotation.set(cur.headX, cur.headY, cur.headZ);
        hips.position.y = 0.62 + cur.hipY;

        /* 귀 스프링 (달리면 통통, 뜨면 뒤로 눕는다) */
        const earDrive = api.victory
          ? (-0.20 - hop * 0.30)                          // 쫑긋 세우고 통통
          : M.clamp(-s.vy * 0.045, -0.55, 0.5) +
            (s.grounded ? Math.sin(phase * 2) * 0.14 * run : 0.22) + s.landImpact * 0.9;
        ear.v += ((earDrive - ear.a) * 210 - ear.v * 21) * dt;
        ear.a += ear.v * dt;
        ear.v2 += ((ear.a * 1.25 - ear.a2) * 150 - ear.v2 * 17) * dt;
        ear.a2 += ear.v2 * dt;
        earL.base.rotation.x = ear.a; earR.base.rotation.x = ear.a * 0.92;
        earL.mid.rotation.x = ear.a2 * 0.8; earR.mid.rotation.x = ear.a2 * 0.72;
        earL.base.rotation.z = -0.17 + Math.sin(t * 1.7) * 0.03;
        earR.base.rotation.z = 0.17 - Math.sin(t * 1.7 + 1) * 0.03;

        /* 착지 스쿼시 */
        if (s.landImpact > 0) squash = Math.max(0.62, 1 - s.landImpact * 0.34);
        squash = M.damp(squash, 1, 9, dt);
        const stretch = s.grounded ? 1 : 1 + M.clamp(Math.abs(s.vy) / 60, 0, 0.12);
        const sy = squash * stretch;
        body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));

        /* 체인 물리 */
        force.set(-Math.sin(yaw) * run * 11, s.grounded ? 0 : -s.vy * 0.8, -Math.cos(yaw) * run * 11);
        const sub = Math.min(3, Math.max(1, Math.ceil(dt / 0.012)));
        const sdt = Math.min(dt, 0.05) / sub;
        for (let i = 0; i < sub; i++) chains.forEach((c) => c.update(sdt, force));
      }
    };

    return api;
  };
})();
