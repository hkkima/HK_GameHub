/* ONLY UP : ZHAO — 게임 루프 / 물리 / 3인칭 카메라 / HUD */
(function () {
  'use strict';
  const OU = window.OU;
  const M = OU.M;
  const V3 = THREE.Vector3;

  /* ===================== 튜닝 값 ===================== */
  const PH = 1.44;        // 플레이어 높이 (4등신 자오)
  const PR = 0.30;        // 플레이어 반폭
  const GRAV_HOLD = 24;   // 점프 유지 시 중력(더 높이 뜬다)
  const GRAV_FALL = 34;   // 하강/짧은 점프 중력
  const TERMINAL = 44;
  const JUMP_V = 11.6;
  const SPD_WALK = 4.4;
  const SPD_RUN = 7.2;
  const ACC_GROUND = 60;
  const ACC_AIR = 24;
  const FRICTION = 15;
  const SLIP_ACC = 11;
  const SLIP_FRICTION = 1.4;
  const BOUNCE_V = 19.5;
  const COYOTE = 0.10;
  const JBUF = 0.13;
  const STEP_UP = 0.38;
  const FIXED = 1 / 120;
  const EPS = 1e-3;
  const SEED = 20260804;

  /* ===================== DOM ===================== */
  const $ = (id) => document.getElementById(id);
  const el = {
    cv: $('cv'), hud: $('hud'), h: $('sH'), best: $('sBest'), time: $('sTime'),
    fall: $('sFall'), cp: $('sCp'), fill: $('meterFill'), bestMark: $('meterBest'),
    mark: $('meterMark'), ticks: $('meterTicks'), toast: $('toast'), vig: $('vig'),
    kAs: $('kAs'), meter: $('meter'),
    scTitle: $('scTitle'), scPause: $('scPause'), scWin: $('scWin'),
    pH: $('pH'), pBest: $('pBest'), pFall: $('pFall'),
    wTime: $('wTime'), wFall: $('wFall'), wH: $('wH'),
    btnStart: $('btnStart'), btnAssist: $('btnAssist'), btnAssist2: $('btnAssist2'),
    btnResume: $('btnResume'), btnRestart: $('btnRestart'), btnAgain: $('btnAgain'),
    loading: $('loading')
  };

  /* ===================== 렌더러 / 씬 ===================== */
  const renderer = new THREE.WebGLRenderer({ canvas: el.cv, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0e1a, 45, 210);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);

  /* 하늘 + 별 */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 24, 18),
    new THREE.MeshBasicMaterial({
      map: OU.verticalGradient([
        [0, '#0a1030'], [0.36, '#151d3d'], [0.55, '#3a2350'],
        [0.72, '#6b2c46'], [0.88, '#1a1526'], [1, '#05060b']
      ]),
      side: THREE.BackSide, depthWrite: false, fog: false
    })
  );
  scene.add(sky);

  const starGeo = new THREE.BufferGeometry();
  {
    const N = 900, p = new Float32Array(N * 3);
    const r = OU.rng(7);
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2, b = Math.acos(r() * 1.4 - 0.4), R = 480;
      p[i * 3] = Math.sin(b) * Math.cos(a) * R;
      p[i * 3 + 1] = Math.cos(b) * R;
      p[i * 3 + 2] = Math.sin(b) * Math.sin(a) * R;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  }
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xdfe8ff, size: 2.4, sizeAttenuation: false, fog: false,
    map: OU.glowTexture(), transparent: true, depthWrite: false, opacity: 0.85
  }));
  scene.add(stars);

  /* 조명 */
  scene.add(new THREE.HemisphereLight(0x4a5f9e, 0x0a0c12, 0.72));
  const sun = new THREE.DirectionalLight(0xffe6c0, 1.05);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 130;
  const SH = 26;
  sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH;
  sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const fillCyan = new THREE.PointLight(0x3ff0ff, 0.85, 26, 2);
  const fillMag = new THREE.PointLight(0xff2f6e, 0.7, 24, 2);
  scene.add(fillCyan, fillMag);

  /* ===================== 월드 & 캐릭터 ===================== */
  const level = OU.buildLevel(scene, SEED);
  const zhao = OU.createZhao(scene);
  const sfx = OU.Sfx();
  zhao.onStep = function (p) { if (state === 'play') sfx.step(p); };

  /* 고도 게이지 눈금 (50m 마다, 라벨은 100m 마다) */
  for (let m = 50; m < level.goalY; m += 50) {
    const i = document.createElement('i');
    i.style.bottom = (m / level.goalY * 100) + '%';
    if (m % 100 === 0) i.innerHTML = '<b>' + m + 'm</b>';
    el.ticks.appendChild(i);
  }

  /* ===================== 골인 연출 (링 + 파티클 + 플래시) ===================== */
  const fx = (function () {
    const grp = new THREE.Group();
    grp.visible = false;
    scene.add(grp);
    const glow = OU.glowTexture();

    const rings = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.05, 8, 44),
        new THREE.MeshBasicMaterial({
          color: i % 2 ? 0x3ff0ff : 0xffd23f, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      m.rotation.x = Math.PI / 2;
      m.visible = false;
      grp.add(m);
      rings.push(m);
    }
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: 0xfff2c0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    grp.add(flash);

    const N = 240;
    const pos = new Float32Array(N * 3), colA = new Float32Array(N * 3);
    const vel = [];
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(colA, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 0.32, map: glow, transparent: true, vertexColors: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    pts.frustumCulled = false;
    grp.add(pts);

    const COLORS = [new THREE.Color(0xffd23f), new THREE.Color(0x3ff0ff),
      new THREE.Color(0xff2f6e), new THREE.Color(0xffffff)];
    const origin = new THREE.Vector3();
    let t = 0, active = false;

    return {
      get active() { return active; },
      get elapsed() { return t; },
      burst(p) {
        origin.copy(p);
        t = 0; active = true; grp.visible = true;
        vel.length = 0;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2 * 7 + i;
          const r = 0.25 + (i % 11) / 11;
          const sp = 4.5 + (i % 17) / 17 * 9;
          vel.push(new THREE.Vector3(Math.cos(a) * r * sp * 0.7, sp * (0.75 + (i % 7) / 14), Math.sin(a) * r * sp * 0.7));
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y + 0.5; pos[i * 3 + 2] = p.z;
          const c = COLORS[i % COLORS.length];
          colA[i * 3] = c.r; colA[i * 3 + 1] = c.g; colA[i * 3 + 2] = c.b;
        }
        pg.attributes.position.needsUpdate = true;
        pg.attributes.color.needsUpdate = true;
        pts.material.opacity = 1;
      },
      update(dt) {
        if (!active) return;
        t += dt;
        for (let i = 0; i < rings.length; i++) {
          const m = rings[i];
          const lt = (t - i * 0.24) / 1.6;
          m.visible = lt > 0 && lt < 1;
          if (!m.visible) continue;
          const s = 0.6 + lt * 14;
          m.scale.set(s, s, s);
          m.position.set(origin.x, origin.y + 0.2 + lt * 2.0, origin.z);
          m.material.opacity = (1 - lt) * 0.8;
        }
        const ft = M.clamp(t / 0.65, 0, 1);
        flash.position.set(origin.x, origin.y + 1.3, origin.z);
        const fs = 6 + ft * 34;
        flash.scale.set(fs, fs, 1);
        flash.material.opacity = (1 - ft) * 0.85;
        const arr = pg.attributes.position.array;
        for (let i = 0; i < N; i++) {
          const v = vel[i];
          v.y -= 11 * dt;
          v.multiplyScalar(1 - 0.55 * dt);
          arr[i * 3] += v.x * dt; arr[i * 3 + 1] += v.y * dt; arr[i * 3 + 2] += v.z * dt;
        }
        pg.attributes.position.needsUpdate = true;
        pts.material.opacity = M.clamp(1 - (t - 2.2) / 2.6, 0, 1);
        if (t > 9) { active = false; grp.visible = false; }
      },
      stop() { active = false; t = 0; grp.visible = false; }
    };
  })();

  /* ===================== 플레이어 상태 ===================== */
  const player = {
    pos: new V3(), vel: new V3(),
    grounded: false, groundCol: null, coyote: 0, jbuf: 0,
    peakAir: 0, landImpact: 0, jumpHeld: false, airTime: 0
  };
  const run = {
    time: 0, falls: 0, peak: 0, cp: 0, started: false,
    best: parseFloat(localStorage.getItem('ouz_best') || '0') || 0,
    assist: localStorage.getItem('ouz_assist') === '1'
  };
  let state = 'title';
  let worldTime = 0;

  /* 카메라 궤도 */
  const cam = { yaw: Math.PI, pitch: -0.16, dist: 6.1, wantDist: 6.1 };
  const camTarget = new V3();
  const camPos = new V3();

  /* ===================== 입력 ===================== */
  const keys = Object.create(null);
  const NOSCROLL = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  addEventListener('keydown', (e) => {
    if (NOSCROLL[e.code]) e.preventDefault();   // 스페이스/방향키의 페이지 스크롤 차단
    if (keys[e.code]) return;
    keys[e.code] = true;
    if (e.code === 'Space') { player.jbuf = JBUF; player.jumpHeld = true; }
    if (e.code === 'Escape') {
      // 포인터 락 해제로 이미 일시정지된 직후의 ESC는 무시(즉시 재개 방지)
      if (state === 'play') pause();
      else if (state === 'pause' && performance.now() - pauseAt > 350) resume();
    }
    if (e.code === 'KeyR' && (state === 'play' || state === 'pause')) restart();
    if (e.code === 'KeyT') setAssist(!run.assist);
    if (e.code === 'KeyM') { sfx.muted = !sfx.muted; toast(sfx.muted ? '음소거' : '사운드 ON'); }
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Space') player.jumpHeld = false;
  });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play') pause(); });

  /* 포인터 락이 걸렸으면 자유 시야, 아니면 드래그로 시야 회전(폴백) */
  let dragging = false;
  addEventListener('mousemove', (e) => {
    const locked = document.pointerLockElement === el.cv;
    if (!locked && !(dragging && state === 'play')) return;
    const dx = e.movementX || 0, dy = e.movementY || 0;
    cam.yaw -= dx * 0.0023;
    cam.pitch = M.clamp(cam.pitch - dy * 0.0021, -1.30, 1.15);
  });
  addEventListener('mouseup', () => { dragging = false; });
  addEventListener('wheel', (e) => {
    if (state !== 'play') return;
    cam.wantDist = M.clamp(cam.wantDist + Math.sign(e.deltaY) * 0.8, 3.0, 15);
  }, { passive: true });
  el.cv.addEventListener('mousedown', () => {
    dragging = true;
    if (state === 'play' && document.pointerLockElement !== el.cv) lock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (state === 'play' && document.pointerLockElement !== el.cv) pause();
  });
  let meterRect = { top: 0, height: 1 };
  function measureHud() { meterRect = el.meter.getBoundingClientRect(); }
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    measureHud();
  });

  function lock() { if (el.cv.requestPointerLock) el.cv.requestPointerLock(); }
  function unlock() { if (document.exitPointerLock) document.exitPointerLock(); }

  /* ===================== 충돌 ===================== */
  function overlaps(c) {
    return player.pos.x - PR < c.maxx - EPS && player.pos.x + PR > c.minx + EPS &&
      player.pos.z - PR < c.maxz - EPS && player.pos.z + PR > c.minz + EPS &&
      player.pos.y < c.maxy - EPS && player.pos.y + PH > c.miny + EPS;
  }

  function resolveHoriz(axis, delta) {
    if (!delta) return;
    const list = level.query(player.pos.y - 1.2, player.pos.y + PH + 1.2);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!overlaps(c)) continue;
      // 낮은 단차는 자동으로 올라선다
      const rise = c.maxy - player.pos.y;
      if (rise > 0.015 && rise <= STEP_UP && player.vel.y <= 0.2) {
        player.pos.y = c.maxy + EPS;
        if (overlaps(c)) { /* 그래도 겹치면 아래에서 밀어낸다 */ } else continue;
      }
      if (axis === 'x') {
        player.pos.x = delta > 0 ? c.minx - PR - EPS : c.maxx + PR + EPS;
        player.vel.x = 0;
      } else {
        player.pos.z = delta > 0 ? c.minz - PR - EPS : c.maxz + PR + EPS;
        player.vel.z = 0;
      }
    }
  }

  let landHandled = false;
  function resolveVert() {
    const list = level.query(player.pos.y - 1.2, player.pos.y + PH + 1.2);
    player.grounded = false;
    player.groundCol = null;
    landHandled = false;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!overlaps(c)) continue;
      const penUp = c.maxy - player.pos.y;              // 위로 올려 해결
      const penDown = player.pos.y + PH - c.miny;        // 아래로 내려 해결
      if (penUp <= penDown) {
        player.pos.y = c.maxy;
        land(c);
      } else {
        player.pos.y = c.miny - PH - EPS;
        if (player.vel.y > 0) player.vel.y = 0;
      }
    }
  }

  function land(c) {
    const vy = player.vel.y;
    player.grounded = true;
    player.groundCol = c;
    if (c.kind === 'bounce') {
      player.vel.y = BOUNCE_V;
      player.grounded = false;
      player.groundCol = null;
      player.peakAir = player.pos.y;
      sfx.bounce();
      return;
    }
    if (vy < -1.2 && !landHandled) {
      landHandled = true;
      player.landImpact = M.clamp(-vy / 26, 0, 1);
      sfx.land(player.landImpact);
      onLanded();
    }
    if (vy < 0) player.vel.y = 0;
    if (c.kind === 'goal' && state === 'play') win();
  }

  /* 하강하는 이동 발판에서 떨어지지 않게 붙여준다 */
  function snapDown(wasGrounded) {
    if (player.grounded || !wasGrounded || player.vel.y > 0.5) return;
    const list = level.query(player.pos.y - 1.2, player.pos.y + PH + 0.4);
    let bestTop = -Infinity, bestC = null;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (player.pos.x - PR >= c.maxx || player.pos.x + PR <= c.minx) continue;
      if (player.pos.z - PR >= c.maxz || player.pos.z + PR <= c.minz) continue;
      if (c.maxy <= player.pos.y - 0.42 || c.maxy > player.pos.y + 0.02) continue;
      if (c.maxy > bestTop) { bestTop = c.maxy; bestC = c; }
    }
    if (bestC) {
      player.pos.y = bestTop;
      player.grounded = true;
      player.groundCol = bestC;
      if (player.vel.y < 0) player.vel.y = 0;
      if (bestC.kind === 'goal' && state === 'play') win();
    }
  }

  /* ===================== 물리 스텝 ===================== */
  const wishDir = new V3();
  const camFwd = new V3(), camRight = new V3();

  function readInput() {
    let f = 0, s = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyA || keys.ArrowLeft) s -= 1;
    if (keys.KeyD || keys.ArrowRight) s += 1;
    camFwd.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    camRight.set(-camFwd.z, 0, camFwd.x);   // cross(fwd, up)
    wishDir.set(0, 0, 0).addScaledVector(camFwd, f).addScaledVector(camRight, s);
    if (wishDir.lengthSq() > 1e-6) wishDir.normalize();
    return wishDir.lengthSq() > 1e-6;
  }

  function step(dt) {
    const moving = readInput();
    const sprint = !!(keys.ShiftLeft || keys.ShiftRight);
    const slip = player.grounded && player.groundCol && player.groundCol.kind === 'slip';

    /* 수평 가속 */
    const targetSpd = sprint ? SPD_RUN : SPD_WALK;
    const acc = player.grounded ? (slip ? SLIP_ACC : ACC_GROUND) : ACC_AIR;
    if (moving) {
      const tx = wishDir.x * targetSpd, tz = wishDir.z * targetSpd;
      player.vel.x = M.moveTo(player.vel.x, tx, acc * dt);
      player.vel.z = M.moveTo(player.vel.z, tz, acc * dt);
    } else if (player.grounded) {
      const fr = (slip ? SLIP_FRICTION : FRICTION) * dt;
      player.vel.x = M.moveTo(player.vel.x, 0, fr);
      player.vel.z = M.moveTo(player.vel.z, 0, fr);
    } else {
      player.vel.x *= 1 - 0.25 * dt;
      player.vel.z *= 1 - 0.25 * dt;
    }
    // 최고 속도 제한(이동 발판 관성은 조금 허용)
    const hs = Math.hypot(player.vel.x, player.vel.z);
    const cap = SPD_RUN * 1.6;
    if (hs > cap) { player.vel.x *= cap / hs; player.vel.z *= cap / hs; }

    /* 상승 기류 */
    for (let i = 0; i < level.updrafts.length; i++) {
      const u = level.updrafts[i];
      const cy = player.pos.y + PH * 0.5;
      if (cy < u.y0 || cy > u.y1) continue;
      if (Math.hypot(player.pos.x - u.x, player.pos.z - u.z) > u.r) continue;
      player.vel.y = Math.min(9.5, player.vel.y + 60 * dt);
      player.grounded = false;
      if (Math.random() < dt * 2.2) sfx.updraft();
    }

    /* 점프 */
    if (player.grounded) player.coyote = COYOTE; else player.coyote -= dt;
    player.jbuf -= dt;
    if (player.jbuf > 0 && player.coyote > 0) {
      player.vel.y = JUMP_V;
      if (player.groundCol && player.groundCol.mover) {
        player.vel.x += M.clamp(player.groundCol.vx, -6, 6);
        player.vel.z += M.clamp(player.groundCol.vz, -6, 6);
        player.vel.y += M.clamp(player.groundCol.vy, 0, 5);
      }
      player.jbuf = 0; player.coyote = 0;
      player.grounded = false; player.groundCol = null;
      player.peakAir = player.pos.y;
      sfx.jump();
    }

    /* 중력 */
    const g = (player.vel.y > 0 && player.jumpHeld) ? GRAV_HOLD : GRAV_FALL;
    player.vel.y = Math.max(-TERMINAL, player.vel.y - g * dt);

    /* 이동 + 충돌 */
    const wasGrounded = player.grounded;
    const dx = player.vel.x * dt, dz = player.vel.z * dt;
    player.pos.x += dx; resolveHoriz('x', dx);
    player.pos.z += dz; resolveHoriz('z', dz);
    player.pos.y += player.vel.y * dt; resolveVert();
    snapDown(wasGrounded);

    if (!player.grounded) {
      player.airTime += dt;
      if (player.pos.y > player.peakAir) player.peakAir = player.pos.y;
    } else player.airTime = 0;

    if (player.pos.y > run.peak) run.peak = player.pos.y;

    /* 나락 */
    if (player.pos.y < -30) respawn();
  }

  /* ===================== 착지 / 추락 처리 ===================== */
  function onLanded() {
    const drop = player.peakAir - player.pos.y;
    if (drop > 10) {
      run.falls++;
      sfx.fail();
      toast('추락! -' + Math.round(drop) + 'm');
      if (run.assist) {
        const cp = level.checkpoints[run.cp];
        if (player.pos.y < cp.y - 6) setTimeout(respawn, 280);
      }
    }
    player.peakAir = player.pos.y;
  }

  /** 어시스트 ON이면 마지막 정착지, OFF면 맨 바닥으로 */
  function respawn() {
    const c = level.checkpoints[run.assist ? run.cp : 0];
    if (!run.assist) run.cp = 0;
    player.pos.set(c.x, c.y + 0.05, c.z + (c.idx === 0 ? 2 : 0));
    player.vel.set(0, 0, 0);
    player.peakAir = player.pos.y;
    player.grounded = true; player.groundCol = null;
    zhao.reset(player.pos, cam.yaw + Math.PI);
    cam.pitch = -0.1;
    toast(c.idx === 0 ? '바닥에서 다시' : '정착지 ' + c.idx + ' 복귀');
  }

  /* 정착지 활성화 체크 */
  function checkCheckpoints() {
    for (let i = 1; i < level.checkpoints.length; i++) {
      const cp = level.checkpoints[i];
      if (cp.active) continue;
      if (Math.abs(player.pos.y - cp.y) > 2.4) continue;
      if (Math.hypot(player.pos.x - cp.x, player.pos.z - cp.z) > 2.6) continue;
      cp.active = true;
      run.cp = Math.max(run.cp, i);
      sfx.checkpoint();
      toast('정착지 ' + cp.idx + ' 확보 · ' + Math.round(cp.y) + 'm');
    }
  }

  /* ===================== 카메라 ===================== */
  const rayDir = new V3();
  function rayBoxes(origin, dir, maxD) {
    const list = level.query(Math.min(origin.y, origin.y + dir.y * maxD) - 1,
      Math.max(origin.y, origin.y + dir.y * maxD) + 1);
    let best = maxD;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      let t0 = 0, t1 = best;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        const o = a === 0 ? origin.x : a === 1 ? origin.y : origin.z;
        const d = a === 0 ? dir.x : a === 1 ? dir.y : dir.z;
        const mn = (a === 0 ? c.minx : a === 1 ? c.miny : c.minz) - 0.28;
        const mx = (a === 0 ? c.maxx : a === 1 ? c.maxy : c.maxz) + 0.28;
        if (Math.abs(d) < 1e-6) { if (o < mn || o > mx) { ok = false; break; } continue; }
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 >= 0 && t0 < best) best = t0;
    }
    return best;
  }

  function updateCamera(dt) {
    camTarget.set(player.pos.x, player.pos.y + PH * 0.78, player.pos.z);
    // 빠르게 떨어질 때 살짝 물러난다
    const fallZoom = M.clamp(-player.vel.y / 30, 0, 1) * 2.2;
    cam.dist = M.damp(cam.dist, cam.wantDist + fallZoom, 6, dt);

    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    rayDir.set(Math.sin(cam.yaw) * cp, -sp, Math.cos(cam.yaw) * cp).normalize();
    const hit = rayBoxes(camTarget, rayDir, cam.dist);
    const d = Math.min(cam.dist, Math.max(1.2, hit - 0.15));
    camPos.copy(camTarget).addScaledVector(rayDir, d);
    camera.position.lerp(camPos, 1 - Math.exp(-24 * dt));
    camera.lookAt(camTarget.x, camTarget.y + 0.1, camTarget.z);

    sky.position.copy(camera.position);
    stars.position.copy(camera.position);

    sun.position.set(player.pos.x + 24, player.pos.y + 40, player.pos.z + 16);
    sun.target.position.set(player.pos.x, player.pos.y, player.pos.z);
    fillCyan.position.set(player.pos.x - 3, player.pos.y + 2.2, player.pos.z - 3);
    fillMag.position.set(player.pos.x + 3, player.pos.y + 0.6, player.pos.z + 3);
  }

  /* ===================== HUD ===================== */
  let toastT = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('on');
    toastT = 2.0;
  }
  let lastRecordToast = 0;

  function updateHud(dt) {
    const h = Math.max(0, player.pos.y);
    el.h.textContent = h.toFixed(1);
    el.best.textContent = run.best.toFixed(1) + ' m';
    el.fall.textContent = run.falls;
    el.cp.textContent = run.cp ? level.checkpoints[run.cp].idx + ' (' + Math.round(level.checkpoints[run.cp].y) + 'm)' : '-';
    const mm = Math.floor(run.time / 60), ss = Math.floor(run.time % 60);
    el.time.textContent = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;

    const f = M.clamp(h / level.goalY, 0, 1);
    el.fill.style.height = (f * 100) + '%';
    el.bestMark.style.bottom = (M.clamp(run.best / level.goalY, 0, 1) * 100) + '%';
    el.mark.style.top = (meterRect.top + meterRect.height * (1 - f)) + 'px';
    el.mark.textContent = h.toFixed(0) + 'm';

    el.vig.style.opacity = M.clamp((-player.vel.y - 16) / 26, 0, 0.9);
    sfx.wind(M.clamp((-player.vel.y - 8) / 30, 0, 1));

    if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.classList.remove('on'); }

    if (run.peak > run.best + 0.05) {
      run.best = run.peak;
      localStorage.setItem('ouz_best', run.best.toFixed(2));
      if (run.best - lastRecordToast > 25 && run.best > 30) {
        lastRecordToast = run.best;
        toast('신기록 ' + Math.round(run.best) + 'm');
      }
    }
  }

  function setAssist(v) {
    run.assist = v;
    localStorage.setItem('ouz_assist', v ? '1' : '0');
    const t = '어시스트 모드: ' + (v ? 'ON' : 'OFF');
    el.btnAssist.textContent = t;
    el.btnAssist2.textContent = t;
    el.kAs.textContent = v ? 'ON' : 'OFF';
    if (state === 'play') toast(v ? '어시스트 ON · 추락 시 정착지 복귀' : '어시스트 OFF · 진짜 등반');
  }

  /* ===================== 상태 전환 ===================== */
  function show(screen) {
    [el.scTitle, el.scPause, el.scWin].forEach((s) => s.classList.remove('on'));
    if (screen) screen.classList.add('on');
    el.hud.classList.toggle('on', !screen || screen === el.scPause);
  }

  function startRun() {
    run.time = 0; run.falls = 0; run.peak = 0; run.cp = 0; run.started = true;
    level.checkpoints.forEach((cp, i) => {
      cp.active = i === 0;
      if (cp.ring) { cp.ring.material.color.set(0x50607a); cp.glow.material.opacity = 0; }
    });
    player.pos.copy(level.start); player.pos.z += 2;
    player.vel.set(0, 0, 0);
    player.peakAir = player.pos.y;
    cam.yaw = Math.PI; cam.pitch = -0.14; cam.dist = cam.wantDist = 6.1;
    zhao.reset(player.pos, 0);
    zhao.victory = false;
    fx.stop();
    level.setBeamBoost(0);
    state = 'play';
    show(null);
    sfx.resume();
    lock();
  }
  let pauseAt = 0;
  function pause() {
    if (state !== 'play') return;
    state = 'pause';
    pauseAt = performance.now();
    el.pH.textContent = player.pos.y.toFixed(1);
    el.pBest.textContent = run.best.toFixed(1);
    el.pFall.textContent = run.falls;
    show(el.scPause);
    sfx.wind(0);
    unlock();
  }
  function resume() { state = 'play'; show(null); lock(); }
  function restart() { startRun(); }

  /* 골인: 연출(state='goal') → 3.2초 후 결과 화면(state='win') */
  const GOAL_CINEMATIC = 3.2;
  let goalT = 0;
  function win() {
    if (state !== 'play') return;
    state = 'goal';
    goalT = 0;
    player.vel.set(0, 0, 0);
    fx.burst(player.pos);
    zhao.victory = true;
    level.setBeamBoost(1);
    sfx.win();
    sfx.wind(0);
    toast('정점 도달! ' + Math.round(player.pos.y) + 'm');
    unlock();
  }
  function showWinCard() {
    state = 'win';
    const mm = Math.floor(run.time / 60), ss = Math.floor(run.time % 60);
    el.wTime.textContent = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
    el.wFall.textContent = run.falls;
    el.wH.textContent = Math.round(player.pos.y);
    show(el.scWin);
  }

  el.btnStart.onclick = startRun;
  el.btnResume.onclick = resume;
  el.btnRestart.onclick = restart;
  el.btnAgain.onclick = startRun;
  el.btnAssist.onclick = () => setAssist(!run.assist);
  el.btnAssist2.onclick = () => setAssist(!run.assist);
  setAssist(run.assist);

  /* 디버그 핸들 (콘솔에서 상태 확인 / 튜닝용) */
  OU.debug = {
    player: player, run: run, cam: cam, level: level, zhao: zhao,
    scene: scene, camera: camera, sfx: sfx, fx: fx,
    startRun: startRun, respawn: respawn,
    get goalT() { return goalT; },
    get state() { return state; },
    tp(y) { // 특정 고도의 정착지로 순간이동
      let best = level.checkpoints[0];
      level.checkpoints.forEach((c) => { if (c.y <= y) best = c; });
      player.pos.set(best.x, best.y + 0.05, best.z);
      player.vel.set(0, 0, 0);
      zhao.reset(player.pos, cam.yaw + Math.PI);
    }
  };

  /* ===================== 메인 루프 ===================== */
  let prev = performance.now(), accum = 0;
  const carry = new V3();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (state === 'pause') { renderer.render(scene, camera); return; }

    worldTime += dt;
    level.update(dt, worldTime);
    fx.update(dt);

    /* 골인 연출: 카메라가 천천히 돌면서 물러난다 */
    if (state === 'goal') {
      goalT += dt;
      cam.yaw += dt * 0.5;
      cam.pitch = M.damp(cam.pitch, -0.03, 2.2, dt);
      cam.wantDist = M.damp(cam.wantDist, 9.0, 1.6, dt);
      updateHud(dt);
      if (goalT >= GOAL_CINEMATIC) showWinCard();
    }

    if (state === 'play') {
      run.time += dt;

      // 서 있는 이동 발판을 따라간다 (프레임당 1회)
      const gc = player.groundCol;
      if (gc && gc.mover) {
        carry.set(gc.dx, gc.dy, gc.dz);
        player.pos.add(carry);
      }

      player.landImpact = 0;
      accum += dt;
      let n = 0;
      while (accum >= FIXED && n < 10) { step(FIXED); accum -= FIXED; n++; }
      if (n === 10) accum = 0;

      checkCheckpoints();
      updateHud(dt);
    }

    /* 캐릭터 */
    const spd = Math.hypot(player.vel.x, player.vel.z);
    zhao.root.position.copy(player.pos);
    zhao.update(dt, {
      speed: spd, grounded: player.grounded, vy: player.vel.y,
      moveDir: spd > 0.3 ? { x: player.vel.x, z: player.vel.z } : null,
      landImpact: player.landImpact
    });

    updateCamera(dt);
    renderer.render(scene, camera);
  }

  /* 초기 배치: 타이틀 화면에서도 캐릭터가 보이도록 */
  player.pos.copy(level.start); player.pos.z += 2;
  player.grounded = true;
  zhao.reset(player.pos, 0);
  cam.yaw = Math.PI;
  updateCamera(0.016);
  camera.position.copy(camPos);
  show(el.scTitle);
  measureHud();
  el.loading.style.display = 'none';
  requestAnimationFrame(frame);

  /* 타이틀 화면에서 천천히 도는 카메라 */
  let titleT = 0;
  (function idleCam() {
    requestAnimationFrame(idleCam);
    if (state !== 'title') return;
    titleT += 0.0016;
    cam.yaw = Math.PI + Math.sin(titleT) * 0.5;
    cam.pitch = -0.12 + Math.sin(titleT * 0.7) * 0.06;
  })();
})();
