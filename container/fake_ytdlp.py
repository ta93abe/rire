#!/usr/bin/env python3
"""Minimal yt-dlp stand-in for container unit tests."""

from __future__ import annotations

import json
import os
import sys


def main() -> int:
    if os.environ.get("FAKE_YTDLP_FAIL") == "geo":
        sys.stderr.write("ERROR: HTTP 403; X-Radiko-Reject-Code: 113 geo restricted\n")
        return 1
    if os.environ.get("FAKE_YTDLP_FAIL") == "exit":
        sys.stderr.write("ERROR: extractor failed\n")
        return 2

    outtmpl = None
    simulate = False
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "-o" and i + 1 < len(args):
            outtmpl = args[i + 1]
            i += 2
            continue
        if args[i] == "--simulate":
            simulate = True
        i += 1

    filepath = None
    if outtmpl and not simulate:
        filepath = outtmpl.replace("%(id)s", "fakeid").replace("%(ext)s", "m4a")
        os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)
        with open(filepath, "wb") as handle:
            handle.write(b"fake-aac-bytes")

    info = {
        "id": "fakeid",
        "title": "Test Program",
        "ext": "m4a",
        "duration": 12.5,
        "extractor": "rajiko",
        "extractor_key": "rajiko",
        "filepath": filepath,
        "requested_downloads": [{"filepath": filepath}] if filepath else [],
    }
    sys.stdout.write(json.dumps(info) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
