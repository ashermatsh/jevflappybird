#!/usr/bin/env python3
"""Serves the game and proxies agent decisions to OpenRouter's decisions API.

Two agents are available, both on the same endpoint with different models:
    agent1  Jev                       (~typesafe/jev-latest)
    agent2  OpenAI decisions          (openai/gpt-6-luna-decisions)

Usage:
    export OPENROUTER_API_KEY=sk-or-...
    python3 server.py              # then open http://localhost:8000/?agent

Without OPENROUTER_API_KEY the server answers with a built-in heuristic
("mock" mode) so the whole pipeline can be tested without calling a model.

Optional env vars:
    DECISIONS_URL  default https://openrouter.ai/api/alpha/decisions
    AGENT1_MODEL   default ~typesafe/jev-latest
    AGENT2_MODEL   default openai/gpt-6-luna-decisions
    PORT       default 8000
"""
import json
import os
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DECISIONS_URL = os.environ.get("DECISIONS_URL", "https://openrouter.ai/api/alpha/decisions")
AGENTS = {
    "agent1": {"name": "Jev", "model": os.environ.get("AGENT1_MODEL", "~typesafe/jev-latest")},
    "agent2": {"name": "OpenAI decisions", "model": os.environ.get("AGENT2_MODEL", "openai/gpt-6-luna-decisions")},
}
API_KEY = os.environ.get("OPENROUTER_API_KEY")
PORT = int(os.environ.get("PORT", "8000"))
SAFE_MARGIN = 18  # px above the bottom pipe the bird should stay
ROOT = os.path.dirname(os.path.abspath(__file__))

QUESTIONS = {
    "action": {
        "type": "choice",
        "instructions": (
            "You control the bird in Flappy Bird. Gravity pulls it down constantly; "
            "a flap gives it a short upward boost. It must pass through the gap between "
            "the pipes without touching them or the ground. Choose the action for right now."
        ),
        "criteria": {
            "flap": "Without a flap the bird would drop below the safe line by the next decision",
            "wait": "Without a flap the bird stays above the safe line until the next decision",
        },
    }
}


def describe(s):
    """Turn the game state into a short plain-English situation for the model."""
    bird = s["bird"]
    y, vy = bird["y"], bird["vy"]
    motion = f"rising at {-vy} px/s" if vy < 0 else f"falling at {vy} px/s" if vy > 0 else "hovering"
    ground = s["world"]["height"] - y - bird["radius"]
    pipes = s.get("pipes") or []
    if not pipes:
        target = s["world"]["height"] / 2
        return (f"No pipes ahead yet. The bird is {motion}, {ground} px above the ground, "
                f"and {round(y - target)} px {'below' if y > target else 'above'} the middle of the screen.")
    p = pipes[0]
    offset = y - p["gapCenter"]
    where = f"{abs(offset)} px {'below' if offset > 0 else 'above'} the middle of the gap"
    if p["dx"] < 0:
        dist = "The bird is inside the pipe opening now."
    else:
        dist = f"The next pipe is {p['dx']} px ahead."
    room_above = y - bird["radius"] - p["gapTop"]
    room_below = p["gapBottom"] - y - bird["radius"]
    margin = p["gapBottom"] - SAFE_MARGIN - predicted_y(s)
    nxt = (f"If it does not flap now, by the next decision it will be {round(margin)} px above the safe line"
           if margin >= 0 else
           f"If it does not flap now, by the next decision it will be {max(1, round(-margin))} px BELOW the safe line")
    return (f"{dist} The bird is {where}, {motion}. Clearance: {room_above} px to the top pipe, "
            f"{room_below} px to the bottom pipe, {ground} px to the ground. {nxt} "
            f"(the safe line is {SAFE_MARGIN} px above the bottom pipe).")


def predicted_y(s):
    """Where the bird will be at the next decision if it does not flap."""
    dt = s.get("interval", 0.1)
    return s["bird"]["y"] + s["bird"]["vy"] * dt + 0.5 * s["world"]["gravity"] * dt * dt


def heuristic(s):
    pipes = s.get("pipes") or []
    line = (pipes[0]["gapBottom"] - SAFE_MARGIN) if pipes else s["world"]["height"] / 2
    return "flap" if predicted_y(s) > line else "wait"


def find_action(obj):
    """Pull 'flap'/'wait' out of the response without assuming its exact shape."""
    if isinstance(obj, dict):
        if "action" in obj:
            v = obj["action"]
            if isinstance(v, str):
                return v.strip().lower()
            if isinstance(v, dict):
                for k in ("value", "answer", "choice", "result", "decision"):
                    if isinstance(v.get(k), str):
                        return v[k].strip().lower()
                found = find_action(v)
                if found:
                    return found
        for v in obj.values():
            found = find_action(v)
            if found:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = find_action(v)
            if found:
                return found
    elif isinstance(obj, str) and obj.strip().lower() in ("flap", "wait"):
        return obj.strip().lower()
    return None


def ask_model(model, state_text):
    body = json.dumps({"model": model, "state": state_text, "questions": QUESTIONS}).encode()
    req = urllib.request.Request(
        DECISIONS_URL,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        path, _, query = self.path.partition("?")
        if path != "/api/decide":
            return self.send_error(404)
        # No default agent: a stale page that omits it should fail loudly, not
        # silently fall back to agent1.
        agent_id = dict(kv.partition("=")[::2] for kv in query.split("&") if kv).get("agent")
        agent = AGENTS.get(agent_id)
        if not agent:
            return self._json(400, {
                "error": f"Unknown or missing agent '{agent_id}'",
                "detail": f"Expected one of {list(AGENTS)}. Hard-refresh the page (Ctrl+Shift+R).",
            })
        try:
            length = int(self.headers.get("Content-Length", 0))
            game_state = json.loads(self.rfile.read(length) or b"{}")
            text = describe(game_state)
            t0 = time.perf_counter()
            if API_KEY:
                raw = ask_model(agent["model"], text)
                action = find_action(raw)
                source = f"{agent_id} ({agent['name']})"
            else:
                action = heuristic(game_state)
                raw = {"mock": True, "action": action}
                source = f"{agent_id} (mock)"
            out = {
                "action": action if action in ("flap", "wait") else "wait",
                "parsed": action is not None,
                "source": source,
                "model": agent["model"],
                "latencyMs": round((time.perf_counter() - t0) * 1000),
                "stateText": text,
                "raw": raw,
            }
            self._json(200, out)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:2000]
            self._json(502, {"error": f"{agent['name']} HTTP {e.code}", "detail": detail})
        except Exception as e:  # noqa: BLE001 - surface every failure to the panel
            self._json(500, {"error": type(e).__name__, "detail": str(e)})

    def end_headers(self):
        # Always serve fresh files so code updates aren't masked by the browser cache.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    for agent_id, a in AGENTS.items():
        print(f"{agent_id}: {a['name']} ({a['model']})")
    if not API_KEY:
        print("MOCK mode: set OPENROUTER_API_KEY to call the real models")
    print(f"Open http://localhost:{PORT}/?agent")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
