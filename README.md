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

## Vision autopilot (OpenAI decisions)

On this branch the game is played by `openai/gpt-6-luna-decisions` through OpenRouter's decisions API
(`https://openrouter.ai/api/alpha/decisions`), using **screenshots instead of numbers**.

```bash
export OPENROUTER_API_KEY=sk-or-...   # omit to run in mock mode (built-in heuristic)
python3 server.py                      # serves the game + /api/decide on port 8000
```

Then open `http://localhost:8000/?agent` (in Codespaces: the forwarded port 8000, adding `?agent`) and press **Start**.

How it works:

1. Every *decision interval*, `agent.js` renders the canvas and downscales it to 200×300.
2. A single frame can't show whether the bird is rising or falling, so the image sent is the
   **previous and current frame side by side** (`BEFORE | NOW`, 400×300 JPEG, ~20 KB).
3. `server.py` sends it as the request `state`, a list of parts:
   ```json
   "state": [
     {"type": "text", "text": "Flappy Bird screenshot. Left half: BEFORE ... Right half: NOW ..."},
     {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
   ]
   ```
   and asks one `choice` question: `action` → `flap` | `wait`.
4. The answer is applied with `jevGame.flap()`. The panel shows the exact image sent and the raw response.

**Lockstep** mode (default) freezes the game while the model thinks and then advances exactly one
interval, so latency doesn't matter. Untick it to make the model play in real time.

The API key stays on the server and is never sent to the browser. Other env vars: `MODEL`, `DECISIONS_URL`, `PORT`.

The **Local heuristic** policy is a baseline (≈20 points per game at a 100 ms interval) that reads exact
game numbers rather than the image.
