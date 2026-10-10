# Jev Flappy Bird

A dependency-free, browser-based Flappy Bird clone built with HTML5 Canvas and vanilla JavaScript.

## Play

Open `index.html` in any modern browser — no build step or server required.
To host it, enable **GitHub Pages** (Settings → Pages → deploy from the `main` branch root).

## Controls

| Action | Input |
| --- | --- |
| Flap / start / restart | Space, ↑, W, Enter, click or tap |
| Pause / resume | P or Esc (tap also resumes) |
| Mute | M |

## Features

- Smooth fixed-timestep physics, crisp on high-DPI screens
- Responsive layout for desktop and mobile
- Gap narrows gradually as your score rises
- Bronze / Silver / Gold / Platinum medals
- Best score saved in your browser
- Retro sound effects synthesized with the Web Audio API (no asset files)
- Auto-pause when the tab is hidden

## Files

- `index.html` – page shell
- `style.css` – layout and scaling
- `game.js` – game logic and rendering

## Autopilot: Agent 1 (Jev) vs Agent 2 (OpenAI decisions)

The game can be played by two models through OpenRouter's decisions API
(`https://openrouter.ai/api/alpha/decisions`):

| Agent | Model | Override with |
| --- | --- | --- |
| Agent 1 – Jev | `~typesafe/jev-latest` | `AGENT1_MODEL` |
| Agent 2 – OpenAI decisions | `openai/gpt-6-luna-decisions` | `AGENT2_MODEL` |

```bash
export OPENROUTER_API_KEY=sk-or-...   # omit to run in mock mode (built-in heuristic)
python3 server.py                      # serves the game + /api/decide on port 8000
```

Then open `http://localhost:8000/?agent` (in Codespaces: the forwarded port 8000, adding `?agent`),
pick an agent and press **Start**. Use **Reset stats** between agents to compare them.

How it works:

1. `agent.js` reads the game via `window.jevGame.getState()` every *decision interval*.
2. It POSTs the state to `server.py` (`/api/decide?agent=agent1|agent2`), which turns it into a
   plain-English `state` and asks the chosen model one `choice` question: `action` → `flap` | `wait`.
3. The answer is applied with `jevGame.flap()`.

**Lockstep** mode (default) freezes the game while the model thinks and then advances exactly one
interval, so latency doesn't matter. Untick it to make the model play in real time.

The API key stays on the server and is never sent to the browser. Other env vars: `DECISIONS_URL`, `PORT`.

The **Local heuristic** policy is a baseline (≈20 points per game at a 100 ms interval) to compare the agents against.
