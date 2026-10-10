#!/usr/bin/env python3
"""Serves the game and lets OpenAI decisions play it from screenshots.

Each decision sends the model an image (the previous and current frame side by
side) through OpenRouter's decisions API, with `state` as a list of parts:
    [{"type": "text", ...}, {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}]

Usage:
    export OPENROUTER_API_KEY=sk-or-...
    python3 server.py              # then open http://localhost:8000/?agent

Without OPENROUTER_API_KEY the server answers with a built-in heuristic
("mock" mode) so the whole pipeline can be tested without calling a model.

Optional env vars:
    DECISIONS_URL  default https://openrouter.ai/api/alpha/decisions
    MODEL          default openai/gpt-6-luna-decisions
    PORT           default 8000
"""
import json
import os
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DECISIONS_URL = os.environ.get("DECISIONS_URL", "https://openrouter.ai/api/alpha/decisions")
MODEL = os.environ.get("MODEL", "openai/gpt-6-luna-decisions")
IMAGE_PREFIXES = ("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")
API_KEY = os.environ.get("OPENROUTER_API_KEY")
PORT = int(os.environ.get("PORT", "8000"))
SAFE_MARGIN = 18  # px above the bottom pipe the mock heuristic aims for
ROOT = os.path.dirname(os.path.abspath(__file__))

QUESTIONS = {
    "action": {
        "type": "choice",
        "instructions": (
            "You control the yellow bird in Flappy Bird, shown in the image. Gravity pulls it down "
            "constantly; a flap gives it a short upward boost. It must fly through the gap in the "
            "green pipes without touching them or the ground. Choose the action for right now."
        ),
        "criteria": {
            "flap": "In the NOW frame the bird is low in the next gap or close to the bottom pipe "
                    "or ground, and it is not already rising fast (compare with the BEFORE frame)",
            "wait": "In the NOW frame the bird is level with or above the middle of the next gap, "
                    "or it is already rising (higher than in the BEFORE frame)",
        },
    }
}


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


def build_state(image, interval):
    ms = round(interval * 1000)
    text = (
        "Flappy Bird screenshot. Left half: BEFORE, the frame from the previous decision "
        f"({ms} ms ago). Right half: NOW, the current frame. The bird flies right through the "
        "gaps in the green pipes. Compare the bird's height in the two frames to see whether it "
        "is rising or falling. Decide based on the NOW frame."
    )
    return [
        {"type": "text", "text": text},
        {"type": "image_url", "image_url": {"url": image}},
    ]


def ask_model(state):
    body = json.dumps({"model": MODEL, "state": state, "questions": QUESTIONS}).encode()
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
        if self.path.partition("?")[0] != "/api/decide":
            return self.send_error(404)
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            image = body.get("image") or ""
            if not image.startswith(IMAGE_PREFIXES):
                return self._json(400, {
                    "error": "Missing or invalid image",
                    "detail": "Expected a PNG/JPEG/WebP data URL. Hard-refresh the page (Ctrl+Shift+R).",
                })
            game_state = body.get("game") or {}
            interval = float(body.get("interval") or 0.1)
            t0 = time.perf_counter()
            if API_KEY:
                raw = ask_model(build_state(image, interval))
                action = find_action(raw)
                source = "openai-decisions"
            else:
                action = heuristic({**game_state, "interval": interval})
                raw = {"mock": True, "action": action}
                source = "mock"
            self._json(200, {
                "action": action if action in ("flap", "wait") else "wait",
                "parsed": action is not None,
                "source": source,
                "model": MODEL,
                "latencyMs": round((time.perf_counter() - t0) * 1000),
                "imageBytes": len(image) * 3 // 4,
                "raw": raw,
            })
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:2000]
            self._json(502, {"error": f"OpenAI decisions HTTP {e.code}", "detail": detail})
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
    print(f"Model: {MODEL} (image input)")
    if not API_KEY:
        print("MOCK mode: set OPENROUTER_API_KEY to call the real models")
    print(f"Open http://localhost:{PORT}/?agent")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
