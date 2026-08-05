/* ONLY UP : ZHAO — 공용 유틸 (수학 / 난수 / 셰이딩 / 사운드) */
(function () {
  'use strict';
  const OU = (window.OU = window.OU || {});

  /* ---------------- 수학 ---------------- */
  const M = (OU.M = {
    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    /** 프레임레이트에 독립적인 지수 보간 */
    damp(a, b, rate, dt) { return M.lerp(a, b, 1 - Math.exp(-rate * dt)); },
    smooth(t) { return t * t * (3 - 2 * t); },
    /** 각도 최단거리 보간 */
    dampAngle(a, b, rate, dt) {
      let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      return a + d * (1 - Math.exp(-rate * dt));
    },
    moveTo(a, b, step) { return Math.abs(b - a) <= step ? b : a + Math.sign(b - a) * step; }
  });

  /** 고정 시드 난수 (mulberry32) — 같은 시드면 항상 같은 탑이 생성된다 */
  OU.rng = function (seed) {
    let s = seed >>> 0;
    const r = function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (a, b) => a + r() * (b - a);
    r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.sign = () => (r() < 0.5 ? -1 : 1);
    r.chance = (p) => r() < p;
    return r;
  };

  /* ---------------- 셀 셰이딩 램프 ---------------- */
  OU.gradientMap = function (stops) {
    const n = stops.length;
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = stops[i];
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, n, 1);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  };

  /* 캔버스로 만드는 상하 그라디언트 (하늘용) */
  OU.verticalGradient = function (colors) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    colors.forEach((cc) => grad.addColorStop(cc[0], cc[1]));
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  };

  /* 부드러운 원형 스프라이트(파티클/글로우용) */
  OU.glowTexture = function (inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, inner || 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,.35)');
    grad.addColorStop(1, outer || 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  };

  /* ---------------- 사운드 (WebAudio 절차 생성) ---------------- */
  OU.Sfx = function () {
    let ac = null, master = null, muted = false;

    function ensure() {
      if (ac) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(ac.destination);
      return ac;
    }

    function tone(o) {
      if (muted || !ensure()) return;
      if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime + (o.delay || 0);
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f0, t0);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(o.vol || 0.18, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + o.dur);
      osc.connect(g); g.connect(master);
      osc.start(t0); osc.stop(t0 + o.dur + 0.02);
    }

    function noise(o) {
      if (muted || !ensure()) return;
      if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime + (o.delay || 0);
      const len = Math.max(0.03, o.dur);
      const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ac.createBufferSource(); src.buffer = buf;
      const flt = ac.createBiquadFilter();
      flt.type = o.type || 'bandpass';
      flt.frequency.setValueAtTime(o.f0 || 700, t0);
      if (o.f1) flt.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t0 + len);
      flt.Q.value = o.q || 1;
      const g = ac.createGain();
      g.gain.setValueAtTime(o.vol || 0.15, t0);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + len);
      src.connect(flt); flt.connect(g); g.connect(master);
      src.start(t0); src.stop(t0 + len + 0.02);
    }

    /* 지속형 낙하 바람소리 */
    let windSrc = null, windGain = null, windFlt = null;
    function windStart() {
      if (muted || !ensure() || windSrc) return;
      const len = 2;
      const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      windSrc = ac.createBufferSource();
      windSrc.buffer = buf; windSrc.loop = true;
      windFlt = ac.createBiquadFilter();
      windFlt.type = 'lowpass'; windFlt.frequency.value = 500;
      windGain = ac.createGain(); windGain.gain.value = 0;
      windSrc.connect(windFlt); windFlt.connect(windGain); windGain.connect(master);
      windSrc.start();
    }
    function windLevel(v) {
      if (!windGain) { if (v > 0) windStart(); else return; }
      if (!windGain) return;
      windGain.gain.setTargetAtTime(muted ? 0 : v * 0.22, ac.currentTime, 0.12);
      windFlt.frequency.setTargetAtTime(360 + v * 900, ac.currentTime, 0.15);
    }

    return {
      resume() { if (ensure() && ac.state === 'suspended') ac.resume(); },
      get muted() { return muted; },
      set muted(v) { muted = v; if (master) master.gain.value = v ? 0 : 0.5; },
      jump() { tone({ type: 'triangle', f0: 300, f1: 620, dur: 0.14, vol: 0.13 }); noise({ f0: 900, f1: 300, dur: 0.1, vol: 0.06 }); },
      land(power) {
        const p = M.clamp(power, 0, 1);
        noise({ type: 'lowpass', f0: 400 + p * 700, f1: 90, dur: 0.14 + p * 0.16, vol: 0.08 + p * 0.16 });
        tone({ type: 'sine', f0: 160 - p * 60, f1: 60, dur: 0.14, vol: 0.06 + p * 0.1 });
      },
      step() { noise({ f0: 1500, f1: 700, dur: 0.05, vol: 0.035, q: 0.7 }); },
      bounce() {
        tone({ type: 'square', f0: 220, f1: 900, dur: 0.2, vol: 0.1 });
        tone({ type: 'sine', f0: 660, f1: 1400, dur: 0.26, vol: 0.07, delay: 0.03 });
      },
      updraft() { noise({ type: 'bandpass', f0: 300, f1: 1800, dur: 0.5, vol: 0.07, q: 2 }); },
      checkpoint() {
        [523, 659, 880].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f, dur: 0.4, vol: 0.1, delay: i * 0.08 }));
      },
      fail() {
        tone({ type: 'sawtooth', f0: 300, f1: 60, dur: 0.6, vol: 0.12 });
        noise({ type: 'lowpass', f0: 700, f1: 80, dur: 0.5, vol: 0.1 });
      },
      win() {
        [523, 659, 784, 1046, 1318].forEach((f, i) =>
          tone({ type: 'triangle', f0: f, f1: f, dur: 0.7, vol: 0.11, delay: i * 0.11 }));
      },
      wind: windLevel
    };
  };
})();
