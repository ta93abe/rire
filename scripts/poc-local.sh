#!/usr/bin/env bash
# 手元で yt-dlp-rajiko がタイムフリー URL を解決できるか確認する（調査メモ 5節 / 13.1）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${1:-https://radiko.jp/#!/ts/FMT/20251012140000}"

python3 -m venv "${ROOT}/.venv"
# shellcheck disable=SC1091
source "${ROOT}/.venv/bin/activate"
pip install -q "yt-dlp>=2025.02.19" "yt-dlp-rajiko==1.13"

echo "URL: ${URL}"
yt-dlp -v -N 10 --simulate "${URL}"
echo "ok: simulate finished"
