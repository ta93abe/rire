# 文書用スケッチを実装した本番 Dockerfile。
FROM python:3.12-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp は 2025.02.19 以降。rajiko は pip（protobug 込み）
RUN pip install --no-cache-dir "yt-dlp>=2025.02.19" "yt-dlp-rajiko==1.13"

WORKDIR /app
COPY server.py /app/server.py

ENV PORT=8080
EXPOSE 8080
CMD ["python", "/app/server.py"]
