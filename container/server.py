"""HTTP job API for radiko timeshift downloads via yt-dlp-rajiko."""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse


PORT = int(os.environ.get("PORT", "8080"))
YTDLP_CMD = os.environ.get("YTDLP_CMD", "yt-dlp")
WORKDIR = os.environ.get("RIRE_WORKDIR", "/tmp/rire")
YTDLP_TIMEOUT_SEC = int(os.environ.get("YTDLP_TIMEOUT_SEC", "1800"))


def classify_error(stderr: str, returncode: int) -> tuple[str, str]:
    text = stderr.lower()
    if (
        "113" in stderr
        or "reject-code" in text
        or "geo restricted" in text
        or "geographic location" in text
        or "not available from your" in text
    ):
        return (
            "GEO_REJECTED",
            "radiko rejected this IP (geo / reject-code 113)",
        )
    return ("YTDLP_EXIT", f"yt-dlp exited {returncode}")


def _safe_replace_template(template: str, video_id: str, ext: str) -> str:
    path = template.replace("%(id)s", video_id).replace("%(ext)s", ext)
    path = re.sub(r"%\([^)]+\)s", "unknown", path)
    return path


def _ytdlp_argv() -> list[str]:
    if YTDLP_CMD.endswith(".py"):
        return [sys.executable, YTDLP_CMD]
    return [YTDLP_CMD]


def run_ytdlp(url: str, simulate: bool) -> dict[str, Any]:
    os.makedirs(WORKDIR, exist_ok=True)
    outtmpl = os.path.join(WORKDIR, "%(id)s.%(ext)s")
    cmd = [
        *_ytdlp_argv(),
        "-N",
        "10",
        "--no-progress",
        "--newline",
        "-o",
        outtmpl,
        "--print-json",
    ]
    if simulate:
        cmd.append("--simulate")
    else:
        cmd.extend(["--embed-metadata", "--embed-thumbnail"])

    email = os.environ.get("RADIKO_EMAIL") or ""
    password = os.environ.get("RADIKO_PASSWORD") or ""
    if email and password:
        cmd.extend(["-u", email, "-p", password])
    cmd.append(url)

    try:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=YTDLP_TIMEOUT_SEC,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("YTDLP_EXIT: yt-dlp timed out") from exc
    except FileNotFoundError as exc:
        raise RuntimeError("YTDLP_EXIT: yt-dlp not installed") from exc

    if completed.returncode != 0:
        code, message = classify_error(completed.stderr or "", completed.returncode)
        raise RuntimeError(f"{code}: {message}")

    info = _parse_info_json(completed.stdout)
    filepath = None
    if not simulate:
        filepath = _find_output_file(info, outtmpl)
        if not filepath or not os.path.isfile(filepath):
            raise RuntimeError("YTDLP_EXIT: yt-dlp produced no output file")

    duration = info.get("duration")
    try:
        duration_sec = float(duration) if duration is not None else None
    except (TypeError, ValueError):
        duration_sec = None

    bytes_count = 0
    if filepath:
        bytes_count = os.path.getsize(filepath)

    sidecar = {
        "title": info.get("title"),
        "station": None,
        "duration": duration_sec,
        "ytDlpId": info.get("id"),
        "sourceUrl": url,
        "recordedAt": _utc_now(),
        "extractor": info.get("extractor") or info.get("extractor_key"),
    }
    return {
        "ok": True,
        "bytes": bytes_count,
        "durationSec": duration_sec,
        "extractor": sidecar["extractor"],
        "sidecar": sidecar,
        "filepath": filepath,
        "simulate": simulate,
    }


def _utc_now() -> str:
    import datetime

    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_info_json(stdout: str) -> dict[str, Any]:
    for line in reversed((stdout or "").splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return {}


def _find_output_file(info: dict[str, Any], outtmpl: str) -> str | None:
    requested = info.get("requested_downloads")
    if isinstance(requested, list):
        for item in requested:
            if isinstance(item, dict):
                for key in ("filepath", "filename", "_filename"):
                    value = item.get(key)
                    if isinstance(value, str) and os.path.isfile(value):
                        return value
    for key in ("filepath", "filename", "_filename"):
        value = info.get(key)
        if isinstance(value, str) and os.path.isfile(value):
            return value
    video_id = str(info.get("id") or "unknown")
    ext = str(info.get("ext") or "m4a")
    candidate = _safe_replace_template(outtmpl, video_id, ext)
    if os.path.isfile(candidate):
        return candidate
    if os.path.isdir(WORKDIR):
        files = [
            os.path.join(WORKDIR, name)
            for name in os.listdir(WORKDIR)
            if os.path.isfile(os.path.join(WORKDIR, name))
        ]
        files.sort(key=os.path.getmtime, reverse=True)
        if files:
            return files[0]
    return None


def validate_timeshift_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    if parsed.hostname not in ("radiko.jp", "www.radiko.jp"):
        return False
    fragment = parsed.fragment or ""
    if fragment.startswith("!/ts/") or fragment.startswith("/ts/"):
        return True
    if parsed.path.rstrip("/") == "/share":
        return "sid=" in parsed.query and "t=" in parsed.query
    return False


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("rire-recorder: " + (fmt % args) + "\n")

    def _write_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] == "/health":
            self._write_json(200, {"ok": True})
            return
        self._write_json(404, {"ok": False, "errorCode": "NOT_FOUND", "errorMessage": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/record":
            self._write_json(404, {"ok": False, "errorCode": "NOT_FOUND", "errorMessage": "not found"})
            return
        length = int(self.headers.get("content-length") or "0")
        if length > 1_000_000:
            self._write_json(413, {"ok": False, "errorCode": "BAD_REQUEST", "errorMessage": "body too large"})
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._write_json(400, {"ok": False, "errorCode": "BAD_REQUEST", "errorMessage": "invalid json"})
            return

        url = payload.get("timeshiftUrl")
        if not isinstance(url, str) or not validate_timeshift_url(url):
            self._write_json(
                400,
                {
                    "ok": False,
                    "errorCode": "BAD_REQUEST",
                    "errorMessage": "timeshiftUrl must be a radiko timeshift URL",
                },
            )
            return

        simulate = payload.get("simulate") is True
        try:
            result = run_ytdlp(url, simulate=simulate)
        except RuntimeError as exc:
            text = str(exc)
            code, _, message = text.partition(": ")
            if not message:
                code, message = "YTDLP_EXIT", text
            status = 403 if code == "GEO_REJECTED" else 500
            self._write_json(status, {"ok": False, "errorCode": code, "errorMessage": message})
            return
        except Exception:
            traceback.print_exc()
            self._write_json(
                500,
                {"ok": False, "errorCode": "YTDLP_EXIT", "errorMessage": "unhandled recorder error"},
            )
            return

        sidecar = result["sidecar"]
        sidecar["station"] = payload.get("stationId")
        meta = {
            "ok": True,
            "bytes": result["bytes"],
            "durationSec": result["durationSec"],
            "extractor": result["extractor"],
            "sidecar": sidecar,
        }
        header_value = base64.b64encode(json.dumps(meta).encode("utf-8")).decode("ascii")
        filepath = result.get("filepath")
        if simulate or not filepath:
            body_len = 0
            self.send_response(200)
            self.send_header("content-type", "audio/mp4")
            self.send_header("content-length", "0")
            self.send_header("x-rire-result", header_value)
            self.end_headers()
            return

        body_len = os.path.getsize(filepath)
        self.send_response(200)
        self.send_header("content-type", "audio/mp4")
        self.send_header("content-length", str(body_len))
        self.send_header("x-rire-result", header_value)
        self.end_headers()
        with open(filepath, "rb") as handle:
            shutil.copyfileobj(handle, self.wfile)
        try:
            os.remove(filepath)
        except OSError:
            pass


def main() -> None:
    os.makedirs(WORKDIR, exist_ok=True)

    def _handle_term(_signum: int, _frame: Any) -> None:
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_term)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"rire recorder listening on {PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
