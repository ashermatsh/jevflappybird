(() => {
  'use strict';

  // Agent panel is opt-in: open the page with ?agent in the URL.
  const panel = document.getElementById('agent');
  if (!new URLSearchParams(location.search).has('agent')) return;
  panel.hidden = false;
  document.body.classList.add('with-agent');

  const game = window.jevGame;
  const $ = (id) => document.getElementById(id);
  const ui = {
    policy: $('ag-policy'), lockstep: $('ag-lockstep'), interval: $('ag-interval'),
    autoRestart: $('ag-restart'), toggle: $('ag-toggle'), status: $('ag-status'),
    games: $('ag-games'), last: $('ag-last'), best: $('ag-best'), avg: $('ag-avg'),
    latency: $('ag-latency'), decisions: $('ag-decisions'), flaps: $('ag-flaps'),
    situation: $('ag-situation'), raw: $('ag-raw'),
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stats = { scores: [], latency: [], decisions: 0, flaps: 0 };
  let running = false;

  // Same rule the server uses in mock mode: flap if, by the next decision,
  // the bird would sink below a line just above the bottom pipe.
  function heuristic(s) {
    const p = s.pipes[0];
    const line = p ? p.gapBottom - 18 : s.world.height / 2;
    const dt = s.interval;
    const predicted = s.bird.y + s.bird.vy * dt + 0.5 * s.world.gravity * dt * dt;
    return predicted > line ? 'flap' : 'wait';
  }

  async function decide(s) {
    if (ui.policy.value === 'local') return { action: heuristic(s), latencyMs: 0, source: 'local' };
    const res = await fetch('/api/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok || data.error) throw new Error(`${data.error || res.status}: ${data.detail || ''}`);
    return data;
  }

  function render() {
    const n = stats.scores.length;
    ui.games.textContent = n;
    ui.last.textContent = n ? stats.scores[n - 1] : '–';
    ui.best.textContent = n ? Math.max(...stats.scores) : '–';
    ui.avg.textContent = n ? (stats.scores.reduce((a, b) => a + b, 0) / n).toFixed(1) : '–';
    const l = stats.latency;
    ui.latency.textContent = l.length ? `${Math.round(l.reduce((a, b) => a + b, 0) / l.length)} ms` : '–';
    ui.decisions.textContent = stats.decisions;
    ui.flaps.textContent = stats.decisions ? `${Math.round((100 * stats.flaps) / stats.decisions)}%` : '–';
  }

  async function run() {
    const lockstep = ui.lockstep.checked;
    game.setExternalClock(lockstep);
    let wasOver = false;

    while (running) {
      const interval = Math.max(20, Number(ui.interval.value) || 100) / 1000;
      const t0 = performance.now();
      const s = { ...game.getState(), interval };

      if (s.status === 'over') {
        if (!wasOver) { stats.scores.push(s.score); wasOver = true; render(); }
        if (!ui.autoRestart.checked) break;
        await sleep(700);
        game.restart();
        continue;
      }
      wasOver = false;

      if (s.status === 'ready') {
        game.flap(); // starts the round
      } else if (s.status === 'playing') {
        try {
          const d = await decide(s);
          if (!running) break;
          if (d.action === 'flap') { game.flap(); stats.flaps++; }
          stats.decisions++;
          stats.latency.push(d.latencyMs ?? performance.now() - t0);
          if (stats.latency.length > 200) stats.latency.shift();
          ui.status.textContent = `${d.source}: ${d.action.toUpperCase()}${d.parsed === false ? ' (unparsed → wait)' : ''}`;
          if (d.stateText) ui.situation.textContent = d.stateText;
          if (d.raw) ui.raw.textContent = JSON.stringify(d.raw, null, 2);
          render();
        } catch (err) {
          ui.status.textContent = 'Error – stopped';
          ui.raw.textContent = String(err.message || err);
          break;
        }
      }

      // Lockstep: the world moves exactly one interval per decision, however
      // slow the model is. Real-time: the world keeps moving while we wait.
      if (lockstep) game.advance(interval);
      await sleep(Math.max(0, interval * 1000 - (performance.now() - t0)));
    }

    running = false;
    game.setExternalClock(false);
    ui.toggle.textContent = 'Start';
  }

  ui.toggle.addEventListener('click', () => {
    running = !running;
    ui.toggle.textContent = running ? 'Stop' : 'Start';
    ui.lockstep.disabled = running;
    if (running) {
      ui.status.textContent = 'Running…';
      run().finally(() => { ui.lockstep.disabled = false; });
    }
  });
  $('ag-reset').addEventListener('click', () => {
    Object.assign(stats, { scores: [], latency: [], decisions: 0, flaps: 0 });
    render();
  });

  render();
})();
