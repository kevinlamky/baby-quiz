/* 愛伴成長 ・ 育嬰知識大挑戰 — game logic
 *
 * Flow: start → choose level → [grid roulette → question → answer + explanation] × 3 → award → reset.
 * No dependencies and no network: works by double-clicking index.html.
 */
(() => {
  "use strict";

  const LEVELS = window.QUIZ_LEVELS;
  let QUESTIONS = LEVELS[0].questions; // the 9 questions of the chosen level
  const ROUNDS = 3;
  const TIME_LIMIT = window.QUIZ_TIME_LIMIT === undefined ? 15 : window.QUIZ_TIME_LIMIT; // seconds, 0 = off
  const LETTERS = ["A", "B", "C", "D"];
  const W = 1600, H = 900;

  const TIERS = {
    3: { key: "gold", title: "金牌育嬰達人！", sub: "三題全對，太厲害了！<br>寶寶有你，真幸福 💕" },
    2: { key: "silver", title: "銀牌育嬰高手！", sub: "答對兩題，非常出色！<br>距離金牌只差一步 ✨" },
    1: { key: "bronze", title: "銅牌育嬰新星！", sub: "答對一題，做得好！<br>繼續學習，陪寶寶一起成長 🌱" },
    0: { key: "none", title: "多謝參與，加油！", sub: "每位爸媽都是邊學邊成長的，<br>今天又學到三個育嬰小知識啦 💪" },
  };

  const $ = (s) => document.querySelector(s);
  const stage = $("#stage");
  const screens = {
    start: $("#screen-start"), level: $("#screen-level"), grid: $("#screen-grid"),
    question: $("#screen-question"), result: $("#screen-result"),
  };
  const gridEl = $("#grid");
  const modal = $("#modal");

  const state = { screen: "start", level: 0, status: [], results: [], current: -1, busy: false, answered: false, gen: 0 };

  /* ---------- helpers ---------- */

  // Timers are tied to the current participant: a reset bumps `gen`, which silently cancels them.
  function later(fn, ms) {
    const gen = state.gen;
    setTimeout(() => { if (gen === state.gen) fn(); }, ms);
  }
  const rand = (n) => Math.floor(Math.random() * n);

  // The stage is landscape. On a phone held upright we draw it turned 90° so it
  // still fills the screen — the player simply turns the phone sideways.
  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const turned = vh > vw && vw < 700;
    const s = turned ? Math.min(vh / W, vw / H) : Math.min(vw / W, vh / H);
    stage.style.transform = `translate(-50%, -50%) ${turned ? "rotate(90deg) " : ""}scale(${s})`;
  }

  function show(name) {
    state.screen = name;
    for (const key in screens) screens[key].classList.toggle("active", key === name);
    stage.classList.toggle("playing", name !== "start");
  }

  /* ---------- sound (synthesised, no audio files) ---------- */

  const Sound = {
    ctx: null, muted: false,
    init() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    },
    tone(freq, dur, { type = "sine", vol = 0.16, at = 0, slide = 0 } = {}) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + at;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      Music.duck(at + dur);
    },
    hurry() { this.tone(988, 0.09, { type: "square", vol: 0.07 }); },
    click() { this.tone(660, 0.09, { type: "triangle", slide: 990 }); },
    tick(p) { this.tone(700 + p * 500, 0.07, { type: "square", vol: 0.06 }); },
    chosen() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.22, { type: "triangle", at: i * 0.09 })); },
    correct() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.28, { type: "triangle", at: i * 0.09, vol: 0.18 })); },
    wrong() { this.tone(330, 0.3, { type: "sine", slide: 262, vol: 0.2 }); this.tone(247, 0.45, { type: "sine", slide: 196, at: 0.26, vol: 0.2 }); },
    drum(i) { this.tone(180, 0.08, { type: "triangle", vol: 0.14, at: i * 0.07 }); },
    fanfare() {
      const notes = [[523, 0], [523, 0.16], [523, 0.32], [659, 0.48], [784, 0.72], [659, 0.92], [784, 1.08], [1047, 1.3]];
      notes.forEach(([f, at], i) => {
        const dur = i === notes.length - 1 ? 0.9 : 0.24;
        this.tone(f, dur, { type: "triangle", at, vol: 0.2 });
        this.tone(f / 2, dur, { type: "sine", at, vol: 0.1 });
      });
    },
    gentle() { [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.5, { type: "sine", at: i * 0.18, vol: 0.16 })); },
  };

  /* ---------- background music (synthesised music-box loop, no audio files) ---------- */

  const Music = {
    on: true, gain: null, timer: 0, step: 0, nextAt: 0, noise: null, steps: null,
    VOLUME: 0.28, DUCK: 0.3, STEP: 0.25, // DUCK = share of the volume kept while a game sound plays; STEP = seconds per eighth note (120 bpm)
    duckTimer: 0, duckEnd: 0,
    // 16 bars in 4/4, written as note/length (length in eighth notes, R = rest). Shape: A A' B A''.
    // Each note stops ringing when the next one starts, so neighbouring notes never blur together.
    MELODY:
      "G5/1 G5/1 E5/2 G5/1 G5/1 E5/2 | C6/2 A5/2 G5/4 | A5/1 A5/1 F5/2 A5/1 A5/1 C6/2 | B5/2 G5/2 D6/4 | " +
      "G5/1 G5/1 E5/2 G5/1 G5/1 E5/2 | C6/2 A5/2 G5/4 | A5/1 C6/1 A5/1 F5/1 G5/1 B5/1 D6/2 | C6/2 E6/2 C6/4 | " +
      "F5/2 A5/2 C6/2 A5/2 | G5/2 E5/1 G5/1 C6/4 | F5/2 A5/2 D6/2 A5/2 | G5/1 A5/1 B5/1 C6/1 D6/2 R/2 | " +
      "G5/1 G5/1 E5/2 G5/1 G5/1 E6/2 | E6/1 C6/1 A5/2 C6/2 A5/2 | A5/1 C6/1 F6/2 D6/1 B5/1 G5/2 | C6/2 G5/2 C6/2 R/2",
    // The chord for each half bar. The left hand plays "oom-pah": a bass note, then a soft chord.
    CHORDS: "C C C C F F G G  C C C C F G C C  F F C C Dm Dm G G  C C Am Am F G C C".split(/\s+/),
    // chord: [bass root, alternate bass (the fifth), the two notes of the soft "pah" chord]
    CHORD: {
      C: ["C3", "G2", "E4", "G4"], F: ["F3", "C3", "F4", "A4"], G: ["G2", "D3", "G4", "B4"],
      Dm: ["D3", "A2", "F4", "A4"], Am: ["A2", "E3", "C4", "E4"],
    },
    freq(name) {
      const semis = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[name[0]] + (Number(name[1]) - 4) * 12;
      return 440 * Math.pow(2, semis / 12);
    },
    // Turn the score above into a list of what to play on each eighth-note step.
    build() {
      const steps = [];
      const add = (i, ev) => (steps[i] = steps[i] || []).push(ev);
      let i = 0;
      for (const tok of this.MELODY.split(" ")) {
        if (tok === "|") continue;
        const [name, len] = tok.split("/");
        if (name !== "R") {
          const f = this.freq(name), dur = Math.min(len * this.STEP * 0.96, 0.8);
          add(i, { f, dur, vol: 0.11, type: "sine" });
          add(i, { f: f * 2, dur: Math.min(dur, 0.3), vol: 0.028, type: "sine" }); // bell-like sparkle
        }
        i += Number(len);
      }
      this.CHORDS.forEach((c, h) => {
        const [root, fifth, n1, n2] = this.CHORD[c];
        const at = h * 4;
        const same = h % 2 === 1 && this.CHORDS[h - 1] === c; // second half of a bar on the same chord
        add(at, { f: this.freq(same ? fifth : root), dur: 0.42, vol: 0.1, type: "triangle" });
        add(at + 2, { f: this.freq(n1), dur: 0.2, vol: 0.035, type: "triangle" });
        add(at + 2, { f: this.freq(n2), dur: 0.2, vol: 0.035, type: "triangle" });
        add(at + 1, { shake: 0.012 });
        add(at + 3, { shake: 0.02 });
      });
      this.steps = steps;
      this.length = this.CHORDS.length * 4;
    },
    note(freq, at, dur, vol, type) {
      const ctx = Sound.ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g).connect(this.gain);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    },
    // A tiny soft shaker on the off-beats, for a little bounce.
    shake(at, vol) {
      const ctx = Sound.ctx;
      const src = ctx.createBufferSource();
      const hp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      src.buffer = this.noise;
      hp.type = "highpass";
      hp.frequency.value = 6000;
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      src.connect(hp).connect(g).connect(this.gain);
      src.start(at);
      src.stop(at + 0.06);
    },
    level() { return this.on && !Sound.muted ? this.VOLUME : 0; },
    refresh() {
      if (this.gain) this.gain.gain.setTargetAtTime(this.level(), Sound.ctx.currentTime, 0.08);
    },
    // Turn the music down while a game sound effect is playing, then bring it back gently.
    duck(seconds) {
      if (!this.gain) return;
      const now = Sound.ctx.currentTime;
      this.duckEnd = Math.max(this.duckEnd, now + seconds);
      this.gain.gain.setTargetAtTime(this.level() * this.DUCK, now, 0.04);
      clearTimeout(this.duckTimer);
      this.duckTimer = setTimeout(() => {
        if (this.gain) this.gain.gain.setTargetAtTime(this.level(), Sound.ctx.currentTime, 0.35);
      }, (this.duckEnd - now + 0.25) * 1000);
    },
    start() {
      if (!Sound.ctx || this.timer) return;
      const ctx = Sound.ctx;
      this.build();
      this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.06), ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.gain = ctx.createGain();
      this.gain.gain.value = this.level();
      this.gain.connect(ctx.destination);
      this.nextAt = ctx.currentTime + 0.3;
      this.timer = setInterval(() => this.schedule(), 200);
    },
    // Queue notes a little ahead of the clock so a busy or background tab does not stutter.
    schedule() {
      // The browser can pause audio (tab in the background, sleep, a phone call). Wake it up again.
      if (Sound.ctx.state !== "running") Sound.ctx.resume().catch(() => {});
      const now = Sound.ctx.currentTime;
      if (this.nextAt < now) this.nextAt = now + 0.05;
      while (this.nextAt < now + 1.2) {
        for (const ev of this.steps[this.step % this.length] || []) {
          if (ev.shake) this.shake(this.nextAt, ev.shake);
          else this.note(ev.f, this.nextAt, ev.dur, ev.vol, ev.type);
        }
        this.step++;
        this.nextAt += this.STEP;
      }
    },
  };

  /* ---------- confetti ---------- */

  const fx = $("#fx");
  const g = fx.getContext("2d");
  const COLORS = ["#f2737b", "#7fcdee", "#ffd60a", "#7ed6b4", "#ffffff", "#e03a32", "#ffb3c1"];
  let parts = [];
  let raf = 0;

  function burst(x, y, n, { spread = Math.PI * 2, angle = -Math.PI / 2, power = 16 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = power * (0.35 + Math.random() * 0.65);
      parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 8 + Math.random() * 10, h: 6 + Math.random() * 8,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
        color: COLORS[rand(COLORS.length)], life: 0, max: 110 + rand(80),
        round: Math.random() < 0.25,
      });
    }
    if (!raf) raf = requestAnimationFrame(drawFx);
  }

  function rain(seconds) {
    const gen = state.gen;
    const end = performance.now() + seconds * 1000;
    (function drop() {
      if (gen !== state.gen || performance.now() > end) return;
      burst(Math.random() * W, -20, 5, { angle: Math.PI / 2, spread: 1.2, power: 6 });
      setTimeout(drop, 90);
    })();
  }

  function drawFx() {
    g.clearRect(0, 0, W, H);
    parts = parts.filter((p) => p.life < p.max && p.y < H + 40);
    for (const p of parts) {
      p.life++;
      p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      g.save();
      g.globalAlpha = Math.min(1, (p.max - p.life) / 25);
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(1, Math.cos(p.life * 0.15 + p.rot)); // flutter
      g.fillStyle = p.color;
      if (p.round) { g.beginPath(); g.arc(0, 0, p.w / 2, 0, 6.29); g.fill(); }
      else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    raf = parts.length ? requestAnimationFrame(drawFx) : 0;
    if (!raf) g.clearRect(0, 0, W, H);
  }

  // Centre of an element in stage coordinates (layout offsets, so it is
  // unaffected by the stage being scaled or turned).
  function centreOf(el) {
    let x = el.offsetWidth / 2, y = el.offsetHeight / 2;
    for (let n = el; n && n !== stage; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    return [x, y];
  }

  /* ---------- floating hearts ---------- */

  function makeFloaters() {
    const box = $("#floaters");
    const glyphs = ["💗", "⭐", "💛", "✨", "🤍", "💙"];
    for (let i = 0; i < 16; i++) {
      const el = document.createElement("span");
      el.className = "floater";
      el.textContent = glyphs[i % glyphs.length];
      el.style.left = `${4 + ((i * 61) % 92)}%`;
      el.style.fontSize = `${24 + ((i * 13) % 26)}px`;
      el.style.animationDuration = `${9 + ((i * 7) % 8)}s`;
      el.style.animationDelay = `${-((i * 37) % 15)}s`;
      box.appendChild(el);
    }
  }

  /* ---------- progress dots ---------- */

  function renderDots(el) {
    el.innerHTML = "";
    for (let i = 0; i < ROUNDS; i++) {
      const d = document.createElement("div");
      const r = state.results[i];
      d.className = "dot" + (r ? (r.correct ? " ok" : " no") : i === state.results.length ? " now" : "");
      d.textContent = r ? (r.correct ? "✓" : "✗") : "";
      el.appendChild(d);
    }
  }

  /* ---------- grid + roulette ---------- */

  const TICK = '<svg viewBox="0 0 100 100"><path d="M18 54 L42 78 L84 26"/></svg>';
  const CROSS = '<svg viewBox="0 0 100 100"><path d="M24 24 L76 76"/><path d="M76 24 L24 76"/></svg>';

  function renderGrid(freshIndex = -1) {
    gridEl.innerHTML = "";
    QUESTIONS.forEach((q, i) => {
      const t = document.createElement("div");
      const st = state.status[i];
      t.className = "tile" + (st ? ` done ${st}` : "") + (i === freshIndex ? " fresh" : "");
      t.style.animationDelay = freshIndex < 0 ? `${i * 0.06}s` : "0s";
      if (freshIndex >= 0) t.style.animation = "none";
      t.innerHTML = `<span class="tile-icon">${q.icon}</span><span class="tile-num">${i + 1}</span>` +
        (st ? `<span class="tile-mark">${st === "correct" ? TICK : CROSS}</span>` : "");
      gridEl.appendChild(t);
    });
    const n = state.results.length + 1;
    $("#grid-round").textContent = `第 ${n} 題`;
    $("#grid-level").textContent = `${LEVELS[state.level].icon} ${LEVELS[state.level].name}`;
    $("#grid-title").textContent = n === 1 ? "按下按鈕，抽出你的題目！" : n === ROUNDS ? "最後一題，加油！" : "再抽下一題！";
    $("#btn-spin").disabled = false;
    renderDots($("#grid-dots"));
  }

  function spin() {
    if (state.busy || state.screen !== "grid") return;
    state.busy = true;
    $("#btn-spin").disabled = true;
    $("#grid-title").textContent = "抽題中……";

    const tiles = [...gridEl.children];
    const remaining = state.status.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
    const target = remaining[rand(remaining.length)];

    // Random hops between unanswered tiles, never the same tile twice in a row, ending on the target.
    const hops = 22 + rand(6);
    const seq = [];
    let prev = -1;
    for (let n = 0; n < hops; n++) {
      const pool = remaining.filter((i) => i !== prev && !(n === hops - 1 && i === target));
      prev = pool[rand(pool.length)];
      seq.push(prev);
    }
    seq.push(target);

    let k = 0;
    const hop = () => {
      tiles.forEach((t, i) => t.classList.toggle("lit", i === seq[k]));
      Sound.tick(k / seq.length);
      k++;
      if (k < seq.length) {
        const p = k / seq.length;
        later(hop, 70 + 400 * p * p * p); // slows down towards the end
      } else {
        later(() => {
          tiles[target].classList.add("chosen");
          $("#grid-title").textContent = `抽中第 ${target + 1} 格！`;
          Sound.chosen();
          burst(...centreOf(tiles[target]), 40, { power: 12 });
          later(() => openQuestion(target), 1500);
        }, 380);
      }
    };
    hop();
  }

  /* ---------- question ---------- */

  function openQuestion(i) {
    const q = QUESTIONS[i];
    state.current = i;
    state.answered = false;
    state.busy = false;

    $("#q-round").textContent = `第 ${state.results.length + 1} 題`;
    $("#q-badge").textContent = `${q.icon} ${i + 1} 號格`;
    $("#q-text").textContent = q.q;
    renderDots($("#q-dots"));
    $("#feedback").classList.remove("show");

    const box = $("#options");
    box.innerHTML = "";
    q.options.forEach((text, k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      b.innerHTML = `<span class="opt-letter">${LETTERS[k]}</span><span></span><span class="opt-flag"></span>`;
      b.children[1].textContent = text;
      b.addEventListener("click", () => answer(k));
      box.appendChild(b);
    });
    show("question");
    startTimer();
  }

  /* ---------- countdown ---------- */

  const RING = 2 * Math.PI * 15.5; // circumference of the pie-slice circle on the clock face
  let timerId = 0;

  function paintTimer(left) {
    $("#timer-ring").style.strokeDashoffset = RING * (1 - left / TIME_LIMIT);
    $("#timer-num").textContent = Math.ceil(left);
    $("#timer").classList.toggle("hurry", left <= 5 && left > 0);
  }

  function stopTimer() {
    clearInterval(timerId);
    timerId = 0;
    $("#timer").classList.remove("hurry");
    $("#timer").classList.add("stopped");
  }

  function startTimer() {
    clearInterval(timerId);
    const el = $("#timer");
    el.style.display = TIME_LIMIT ? "" : "none";
    if (!TIME_LIMIT) return;
    el.classList.remove("stopped");
    paintTimer(TIME_LIMIT);
    // Start counting once the options have finished animating in.
    later(() => {
      if (state.answered || state.screen !== "question") return;
      const end = performance.now() + TIME_LIMIT * 1000;
      let lastBeep = 6;
      timerId = setInterval(() => {
        const left = Math.max(0, (end - performance.now()) / 1000);
        paintTimer(left);
        const sec = Math.ceil(left);
        if (sec <= 5 && sec < lastBeep && sec > 0) { lastBeep = sec; Sound.hurry(); }
        if (left <= 0) answer(-1); // time's up counts as a wrong answer
      }, 100);
    }, 900);
  }

  function answer(k) {
    if (state.answered || state.screen !== "question") return;
    stopTimer();
    state.answered = true;
    const q = QUESTIONS[state.current];
    const ok = k === q.answer;
    const opts = [...$("#options").children];

    opts.forEach((b, i) => {
      b.disabled = true;
      if (i === q.answer) { b.classList.add("is-correct"); b.lastChild.textContent = "✓"; }
      else if (i === k) { b.classList.add("is-wrong"); b.lastChild.textContent = "✗"; }
      else b.classList.add("is-dim");
    });

    state.status[state.current] = ok ? "correct" : "wrong";
    state.results.push({ index: state.current, correct: ok });
    renderDots($("#q-dots"));

    const verdict = $("#verdict");
    verdict.className = "verdict " + (ok ? "ok" : k < 0 ? "time" : "no");
    verdict.innerHTML = ok
      ? "🎉 答對了！"
      : `${k < 0 ? "⏰ 時間到" : "😮 答錯了"}<small>正確答案是 ${LETTERS[q.answer]}</small>`;
    $("#explain").textContent = q.explain;
    $("#btn-next").textContent = state.results.length < ROUNDS ? "下一題 ➜" : "看成績 🏅";
    $("#feedback").classList.add("show");

    if (ok) {
      Sound.correct();
      burst(...centreOf(opts[k]), 70, { power: 17 });
    } else {
      Sound.wrong();
    }
  }

  function next() {
    if (!state.answered || state.screen !== "question") return;
    Sound.click();
    if (state.results.length >= ROUNDS) return showResult();
    renderGrid(state.current);
    show("grid");
  }

  /* ---------- award ceremony ---------- */

  function medalSVG(tier) {
    const c = {
      gold: ["#fff6c4", "#ffd43b", "#f59f00", "#a86400", "金"],
      silver: ["#ffffff", "#dfe5ec", "#a9b4c0", "#5f6b78", "銀"],
      bronze: ["#ffe3c7", "#eaa66c", "#c0713a", "#74401d", "銅"],
    }[tier];
    return `<svg viewBox="0 0 290 366">
      <defs>
        <radialGradient id="mg-${tier}" cx="35%" cy="30%" r="80%">
          <stop offset="0" stop-color="${c[0]}"/><stop offset=".45" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/>
        </radialGradient>
      </defs>
      <path d="M78 0h58l44 150h-58z" fill="#e2525c"/>
      <path d="M212 0h-58l-44 150h58z" fill="#f58d94"/>
      <path d="M122 150h46l-23 -78z" fill="#c9414c" opacity=".55"/>
      <circle cx="145" cy="240" r="118" fill="url(#mg-${tier})" stroke="${c[2]}" stroke-width="9"/>
      <circle cx="145" cy="240" r="92" fill="none" stroke="${c[0]}" stroke-width="5" stroke-dasharray="3 13" stroke-linecap="round" opacity=".9"/>
      <ellipse cx="108" cy="188" rx="34" ry="16" fill="#fff" opacity=".55" transform="rotate(-32 108 188)"/>
      <text x="145" y="280" text-anchor="middle" font-size="112" font-weight="900" font-family="inherit"
            fill="${c[3]}" stroke="${c[0]}" stroke-width="3" paint-order="stroke">${c[4]}</text>
    </svg>`;
  }

  function showResult() {
    const score = state.results.filter((r) => r.correct).length;
    const tier = TIERS[score];
    const panel = $("#result-panel");

    panel.className = `panel panel-result tier-${tier.key}`;
    $("#medal").innerHTML = tier.key === "none" ? '<div class="heart">💖</div>' : medalSVG(tier.key);
    $("#award-title").textContent = tier.title;
    $("#award-sub").innerHTML = tier.sub;
    $("#chips").innerHTML = `<span class="chip lvl">${LEVELS[state.level].icon} ${LEVELS[state.level].name}</span>` + state.results
      .map((r, i) => `<span class="chip ${r.correct ? "ok" : "no"}">第 ${i + 1} 題 ${r.correct ? "✓" : "✗"}</span>`)
      .join("");
    show("result");

    for (let i = 0; i < 22; i++) Sound.drum(i + 6);
    later(() => {
      panel.classList.add("reveal");
      if (score > 0) {
        Sound.fanfare();
        later(() => {
          burst(W / 2 - 330, 560, 60 * score, { angle: -1.1, spread: 1.1, power: 24 });
          burst(W / 2 + 330, 560, 60 * score, { angle: -2.04, spread: 1.1, power: 24 });
          rain(1.5 + score * 1.5);
        }, 700);
      } else {
        Sound.gentle();
        later(() => burst(W / 2, 330, 50, { power: 11 }), 800);
      }
    }, 2100);
  }

  /* ---------- start / reset ---------- */

  function resetState() {
    stopTimer();
    state.gen++;
    state.status = QUESTIONS.map(() => null);
    state.results = [];
    state.current = -1;
    state.busy = false;
    state.answered = false;
    parts = [];
  }

  function renderLevels() {
    const box = $("#levels");
    LEVELS.forEach((lv, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `level-card level-${lv.key}`;
      b.innerHTML = `<span class="level-icon">${lv.icon}</span><span class="level-name">${lv.name}</span>` +
        `<span class="level-hint">${lv.hint}</span><span class="level-key">${i + 1}</span>`;
      b.addEventListener("click", () => chooseLevel(i));
      box.appendChild(b);
    });
  }

  function startGame() {
    Sound.init();
    Music.start();
    Sound.click();
    resetState();
    show("level");
  }

  function chooseLevel(i) {
    if (state.screen !== "level" || !LEVELS[i]) return;
    Sound.click();
    state.level = i;
    QUESTIONS = LEVELS[i].questions;
    resetState();
    renderGrid();
    show("grid");
  }

  function backToStart() {
    Sound.init();
    Sound.click();
    resetState();
    closeModal();
    show("start");
  }

  function askReset() {
    if (state.screen === "start") return;
    // Nothing to lose once the medal has been awarded — skip the confirmation.
    if (state.screen === "result" || state.screen === "level") return backToStart();
    modal.classList.add("open");
  }
  function closeModal() { modal.classList.remove("open"); }

  /* ---------- wiring ---------- */

  $("#btn-start").addEventListener("click", startGame);
  $("#btn-spin").addEventListener("click", () => { Sound.click(); spin(); });
  $("#btn-next").addEventListener("click", next);
  $("#btn-again").addEventListener("click", backToStart);
  $("#btn-reset").addEventListener("click", askReset);
  $("#btn-cancel").addEventListener("click", closeModal);
  $("#btn-confirm").addEventListener("click", backToStart);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  $("#btn-sound").addEventListener("click", (e) => {
    Sound.muted = !Sound.muted;
    e.currentTarget.textContent = Sound.muted ? "🔇" : "🔊";
    e.currentTarget.classList.toggle("off", Sound.muted);
    Music.refresh();
  });
  $("#btn-music").addEventListener("click", (e) => {
    Sound.init();
    Music.on = !Music.on;
    Music.start();
    Music.refresh();
    e.currentTarget.classList.toggle("off", !Music.on);
  });
  $("#btn-full").addEventListener("click", () => {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else {
      const el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    }
  });

  // Keyboard: Enter/Space = main button, 1–3 = level, 1–4 or A–D = answer, Esc = close dialog, F = fullscreen.
  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (modal.classList.contains("open")) {
      if (key === "escape") closeModal();
      if (key === "enter") { e.preventDefault(); backToStart(); }
      return;
    }
    if (key === "enter" || key === " ") {
      e.preventDefault();
      const main = { start: "#btn-start", grid: "#btn-spin", question: "#btn-next", result: "#btn-again" }[state.screen];
      if (!main) return;
      const btn = $(main);
      if (state.screen === "result" && !$("#result-panel").classList.contains("reveal")) return;
      if (!btn.disabled) btn.click();
      return;
    }
    if (key === "f") return $("#btn-full").click();
    if (state.screen === "level") return chooseLevel("123".indexOf(key));
    if (state.screen === "question") {
      const k = "1234".indexOf(key) >= 0 ? "1234".indexOf(key) : "abcd".indexOf(key);
      if (k >= 0) answer(k);
    }
  });

  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", () => setTimeout(fit, 200));
  document.addEventListener("dragstart", (e) => e.preventDefault());
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // Music starts as soon as the page opens if the browser allows sound without a click.
  // Most browsers do not, so the very first click, tap or key press anywhere starts it instead.
  function wakeAudio() { Sound.init(); Music.start(); }
  ["pointerdown", "touchstart", "keydown"].forEach((ev) => document.addEventListener(ev, wakeAudio, true));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Sound.ctx) Sound.ctx.resume().catch(() => {}); });
  wakeAudio();

  fit();
  makeFloaters();
  renderLevels();
  resetState();
})();
