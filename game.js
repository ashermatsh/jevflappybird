(() => {
  'use strict';

  // ---- Setup -------------------------------------------------------------
  const W = 400;
  const H = 600;
  const GROUND_H = 80;
  const PLAY_H = H - GROUND_H;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Tuning (units: px, seconds) --------------------------------------
  const GRAVITY = 1500;
  const FLAP_VELOCITY = -430;
  const MAX_FALL = 650;
  const PIPE_W = 64;
  const PIPE_SPEED = 160;
  const PIPE_SPACING = 220;
  const GAP_START = 160;
  const GAP_MIN = 125;
  const BIRD_X = 110;
  const BIRD_R = 14;

  // ---- Persistent best score --------------------------------------------
  const BEST_KEY = 'jevFlappyBest';
  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* ignore */ }
  }

  // ---- Sound (tiny WebAudio synth, no assets) ---------------------------
  let audio = null;
  let muted = false;
  function beep(freq, dur, type = 'square', vol = 0.08, slideTo = null) {
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch { /* audio unsupported */ }
  }
  const sfx = {
    flap: () => beep(520, 0.09, 'square', 0.05, 760),
    point: () => { beep(880, 0.08, 'square', 0.05); setTimeout(() => beep(1320, 0.12, 'square', 0.05), 80); },
    hit: () => beep(220, 0.3, 'sawtooth', 0.08, 60),
  };

  // ---- State -------------------------------------------------------------
  const State = { READY: 0, PLAYING: 1, DYING: 2, OVER: 3 };
  let state, bird, pipes, score, best = loadBest(), newBest;
  let groundX = 0, time = 0, paused = false, flash = 0, overAt = 0;

  const clouds = Array.from({ length: 5 }, (_, i) => ({
    x: i * 100 + Math.random() * 60,
    y: 40 + Math.random() * 160,
    s: 0.6 + Math.random() * 0.7,
  }));
  const city = Array.from({ length: 14 }, (_, i) => ({
    x: i * 32,
    w: 24 + Math.random() * 18,
    h: 40 + Math.random() * 70,
  }));

  function reset() {
    state = State.READY;
    bird = { y: PLAY_H / 2 - 20, vy: 0, rot: 0, wing: 0 };
    pipes = [];
    score = 0;
    newBest = false;
  }

  function currentGap() {
    return Math.max(GAP_MIN, GAP_START - score * 1.5);
  }

  function spawnPipe(x) {
    const gap = currentGap();
    const margin = 60;
    const top = margin + Math.random() * (PLAY_H - gap - margin * 2);
    pipes.push({ x, top, gap, scored: false });
  }

  // ---- Input -------------------------------------------------------------
  function flap() {
    if (paused) { paused = false; return; }
    if (state === State.READY) {
      state = State.PLAYING;
      spawnPipe(W + 40);
    }
    if (state === State.PLAYING) {
      bird.vy = FLAP_VELOCITY;
      sfx.flap();
    } else if (state === State.OVER && time - overAt > 0.5) {
      reset();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Enter') {
      e.preventDefault();
      if (!e.repeat) flap();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === State.PLAYING) paused = !paused;
    } else if (e.code === 'KeyM') {
      muted = !muted;
    }
  });
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); flap(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === State.PLAYING) paused = true;
  });

  // ---- Update ------------------------------------------------------------
  function hitsPipe(p) {
    // circle vs. two rectangles
    const cx = BIRD_X, cy = bird.y, r = BIRD_R - 2;
    const rects = [
      [p.x, -1000, PIPE_W, p.top + 1000],
      [p.x, p.top + p.gap, PIPE_W, PLAY_H - (p.top + p.gap)],
    ];
    return rects.some(([x, y, w, h]) => {
      const nx = Math.max(x, Math.min(cx, x + w));
      const ny = Math.max(y, Math.min(cy, y + h));
      return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
    });
  }

  function die() {
    sfx.hit();
    flash = 1;
    state = State.DYING;
    if (score > best) {
      best = score;
      newBest = true;
      saveBest(best);
    }
  }

  function update(dt) {
    time += dt;
    flash = Math.max(0, flash - dt * 3);

    const scrolling = state === State.READY || state === State.PLAYING;
    if (scrolling) {
      groundX = (groundX - PIPE_SPEED * dt) % 24;
      for (const c of clouds) {
        c.x -= 12 * c.s * dt;
        if (c.x < -80) { c.x = W + 40; c.y = 40 + Math.random() * 160; }
      }
      for (const b of city) {
        b.x -= 30 * dt;
        if (b.x < -50) b.x += city.length * 32;
      }
    }

    if (state === State.READY) {
      bird.y = PLAY_H / 2 - 20 + Math.sin(time * 4) * 8;
      bird.rot = 0;
      bird.wing += dt * 10;
      return;
    }

    if (state === State.PLAYING || state === State.DYING) {
      bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
      bird.y += bird.vy * dt;
      const targetRot = bird.vy < 0 ? -0.45 : Math.min(Math.PI / 2, bird.vy / 450);
      bird.rot += (targetRot - bird.rot) * Math.min(1, dt * 12);
      if (state === State.PLAYING) bird.wing += dt * 18;

      if (bird.y - BIRD_R < 0) { bird.y = BIRD_R; bird.vy = 0; }

      if (bird.y + BIRD_R >= PLAY_H) {
        bird.y = PLAY_H - BIRD_R;
        if (state === State.PLAYING) die();
        state = State.OVER;
        overAt = time;
        return;
      }
    }

    if (state === State.PLAYING) {
      for (const p of pipes) {
        p.x -= PIPE_SPEED * dt;
        if (!p.scored && p.x + PIPE_W < BIRD_X - BIRD_R) {
          p.scored = true;
          score++;
          sfx.point();
        }
        if (hitsPipe(p)) { die(); break; }
      }
      const last = pipes[pipes.length - 1];
      if (last && last.x < W - PIPE_SPACING) spawnPipe(last.x + PIPE_SPACING);
      pipes = pipes.filter((p) => p.x + PIPE_W > -10);
    }
  }

  // ---- Draw --------------------------------------------------------------
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, PLAY_H);
    g.addColorStop(0, '#4ec0ca');
    g.addColorStop(1, '#a8e4e8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, PLAY_H);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const c of clouds) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 18 * c.s, 0, Math.PI * 2);
      ctx.arc(c.x + 20 * c.s, c.y - 8 * c.s, 22 * c.s, 0, Math.PI * 2);
      ctx.arc(c.x + 42 * c.s, c.y, 18 * c.s, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const b of city) {
      ctx.fillStyle = '#8fd3b0';
      ctx.fillRect(b.x, PLAY_H - b.h - 20, b.w, b.h + 20);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let wy = PLAY_H - b.h - 12; wy < PLAY_H - 30; wy += 12) {
        for (let wx = b.x + 4; wx < b.x + b.w - 6; wx += 8) ctx.fillRect(wx, wy, 4, 5);
      }
    }
    ctx.fillStyle = '#5ec27a';
    for (let x = -20; x < W + 40; x += 36) {
      ctx.beginPath();
      ctx.arc(x + (groundX * 0.5) % 36, PLAY_H - 6, 24, Math.PI, 0);
      ctx.fill();
    }
  }

  function drawPipe(x, y, h, flipped) {
    const lip = 26;
    const body = ctx.createLinearGradient(x, 0, x + PIPE_W, 0);
    body.addColorStop(0, '#5aa531');
    body.addColorStop(0.35, '#9be15d');
    body.addColorStop(1, '#3d7a1f');
    ctx.fillStyle = body;
    ctx.fillRect(x + 3, y, PIPE_W - 6, h);
    ctx.strokeStyle = '#2b5416';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y, PIPE_W - 6, h);

    const ly = flipped ? y + h - lip : y;
    ctx.fillStyle = body;
    ctx.fillRect(x - 2, ly, PIPE_W + 4, lip);
    ctx.strokeRect(x - 2, ly, PIPE_W + 4, lip);
  }

  function drawPipes() {
    for (const p of pipes) {
      drawPipe(p.x, -4, p.top + 4, true);
      const by = p.top + p.gap;
      drawPipe(p.x, by, PLAY_H - by, false);
    }
  }

  function drawGround() {
    ctx.fillStyle = '#ded895';
    ctx.fillRect(0, PLAY_H, W, GROUND_H);
    ctx.fillStyle = '#73bf2e';
    ctx.fillRect(0, PLAY_H, W, 14);
    ctx.fillStyle = '#5a9a22';
    for (let x = groundX; x < W; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, PLAY_H + 14);
      ctx.lineTo(x + 12, PLAY_H);
      ctx.lineTo(x + 24, PLAY_H);
      ctx.lineTo(x + 12, PLAY_H + 14);
      ctx.fill();
    }
    ctx.fillStyle = '#543847';
    ctx.fillRect(0, PLAY_H, W, 2);
    ctx.fillRect(0, PLAY_H + 14, W, 2);
  }

  function drawBird() {
    ctx.save();
    ctx.translate(BIRD_X, bird.y);
    ctx.rotate(bird.rot);

    // body
    ctx.fillStyle = '#f8d32b';
    ctx.strokeStyle = '#543847';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, BIRD_R + 3, BIRD_R, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // belly
    ctx.fillStyle = '#fbeec0';
    ctx.beginPath();
    ctx.ellipse(-2, 6, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // wing
    const flapOffset = Math.sin(bird.wing) * 5;
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath();
    ctx.ellipse(-8, 1 + flapOffset * 0.6, 8, 5 + Math.abs(flapOffset) * 0.3, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // eye
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(8, -5, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(10, -5, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // beak
    ctx.fillStyle = '#f2702c';
    ctx.beginPath();
    ctx.moveTo(12, 1);
    ctx.lineTo(24, 4);
    ctx.lineTo(12, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function text(str, x, y, size, align = 'center', fill = '#fff') {
    ctx.font = `bold ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size / 6);
    ctx.strokeStyle = '#543847';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(str, x, y);
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = '#ded895';
    ctx.strokeStyle = '#543847';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
  }

  function medalFor(s) {
    if (s >= 40) return ['#e5e4e2', 'Platinum'];
    if (s >= 30) return ['#ffd700', 'Gold'];
    if (s >= 20) return ['#c0c0c0', 'Silver'];
    if (s >= 10) return ['#cd7f32', 'Bronze'];
    return null;
  }

  function drawUI() {
    if (state === State.PLAYING || state === State.DYING) {
      text(String(score), W / 2, 70, 48);
    }

    if (state === State.READY) {
      text('Jev Flappy Bird', W / 2, 130, 38, 'center', '#ffe066');
      text('Get Ready!', W / 2, 190, 28);
      const pulse = 0.6 + 0.4 * Math.sin(time * 5);
      ctx.globalAlpha = pulse;
      text('Tap, click or press Space', W / 2, PLAY_H - 90, 18);
      ctx.globalAlpha = 1;
      if (best > 0) text(`Best: ${best}`, W / 2, PLAY_H - 55, 18);
    }

    if (state === State.OVER) {
      text('Game Over', W / 2, 140, 44, 'center', '#ff8a3d');
      const pw = 260, ph = 140, px = (W - pw) / 2, py = 200;
      panel(px, py, pw, ph);

      const medal = medalFor(score);
      ctx.save();
      ctx.translate(px + 60, py + 72);
      ctx.fillStyle = medal ? medal[0] : '#cfc98a';
      ctx.strokeStyle = '#543847';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (medal) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(-8, -8, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (medal) {
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillStyle = '#543847';
        ctx.textAlign = 'center';
        ctx.fillText(medal[1], px + 60, py + 118);
      }

      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillStyle = '#e86101';
      ctx.textAlign = 'right';
      ctx.fillText('SCORE', px + pw - 20, py + 28);
      ctx.fillText('BEST', px + pw - 20, py + 82);
      text(String(score), px + pw - 20, py + 52, 26, 'right');
      text(String(best), px + pw - 20, py + 106, 26, 'right');
      if (newBest) {
        ctx.fillStyle = '#ff3d3d';
        ctx.beginPath();
        ctx.roundRect(px + 115, py + 72, 42, 18, 4);
        ctx.fill();
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('NEW', px + 136, py + 82);
      }

      if (time - overAt > 0.5) {
        const pulse = 0.6 + 0.4 * Math.sin(time * 5);
        ctx.globalAlpha = pulse;
        text('Tap or press Space to restart', W / 2, 390, 18);
        ctx.globalAlpha = 1;
      }
    }

    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, W, H);
      text('Paused', W / 2, H / 2 - 20, 40);
      text('Press P to resume', W / 2, H / 2 + 25, 18);
    }

    if (muted) text('🔇', W - 22, 22, 16);

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawPipes();
    drawGround();
    drawBird();
    drawUI();
  }

  // ---- Loop (fixed timestep for consistent physics) ----------------------
  const STEP = 1 / 120;
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // avoid spiral after tab switch
    if (!paused) {
      acc += dt;
      while (acc >= STEP) {
        update(STEP);
        acc -= STEP;
      }
    } else {
      acc = 0;
    }
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  requestAnimationFrame(frame);
})();
