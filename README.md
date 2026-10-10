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
