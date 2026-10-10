#!/usr/bin/env python3
"""Serves the game and proxies agent decisions to Jev (OpenRouter decisions API).

Usage:
    export OPENROUTER_API_KEY=sk-or-...
    python3 server.py              # then open http://localhost:8000/?agent

Without OPENROUTER_API_KEY the server answers with a built-in heuristic
("mock" mode) so the whole pipeline can be tested without Jev.

Optional env vars:
    JEV_URL    default https://openrouter.ai/api/alpha/decisions
    JEV_MODEL  default ~typesafe/jev-latest
    PORT       default 8000
"""
import json
import os
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

JEV_URL = os.environ.get("JEV_URL", "https://openrouter.ai/api/alpha/decisions")
JEV_MODEL = os.environ.get("JEV_MODEL", "~typesafe/jev-latest")
API_KEY = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("JEV_API_KEY")
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
    """Turn the game state into a short plain-English situation for Jev."""
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


def ask_jev(state_text):
    body = json.dumps({"model": JEV_MODEL, "state": state_text, "questions": QUESTIONS}).encode()
    req = urllib.request.Request(
        JEV_URL,
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
        if self.path != "/api/decide":
            return self.send_error(404)
        try:
            length = int(self.headers.get("Content-Length", 0))
            game_state = json.loads(self.rfile.read(length) or b"{}")
            text = describe(game_state)
            t0 = time.perf_counter()
            if API_KEY:
                raw = ask_jev(text)
                action = find_action(raw)
                source = "jev"
            else:
                action = heuristic(game_state)
                raw = {"mock": True, "action": action}
                source = "mock"
            out = {
                "action": action if action in ("flap", "wait") else "wait",
                "parsed": action is not None,
                "source": source,
                "latencyMs": round((time.perf_counter() - t0) * 1000),
                "stateText": text,
                "raw": raw,
            }
            self._json(200, out)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:2000]
            self._json(502, {"error": f"Jev HTTP {e.code}", "detail": detail})
        except Exception as e:  # noqa: BLE001 - surface every failure to the panel
            self._json(500, {"error": type(e).__name__, "detail": str(e)})

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
    mode = f"Jev ({JEV_MODEL})" if API_KEY else "MOCK (set OPENROUTER_API_KEY to use Jev)"
    print(f"Decision backend: {mode}")
    print(f"Open http://localhost:{PORT}/?agent")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
