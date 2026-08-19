#!/usr/bin/env bash
# 手元で yt-dlp-rajiko がタイムフリー URL を解決できるか確認する（調査メモ 5節 / 13.1）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${1:-https://radiko.jp/#!/ts/FMT/20251012140000}"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv が PATH にありません。 https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi

echo "URL: ${URL}"
uv --directory "${ROOT}/container" sync --frozen --no-dev
uv --directory "${ROOT}/container" run yt-dlp -v -N 10 --simulate "${URL}"
echo "ok: simulate finished"
