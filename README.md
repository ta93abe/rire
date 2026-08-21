# rire

radiko のタイムフリーを、個人利用のアーカイブとして Cloudflare 上で定期取得するための実験リポジトリです。

技術的には **yt-dlp-rajiko + Cloudflare Containers** で、放送終了後のタイムシフトを取り R2 に置きます。radiko の利用規約上の許可を主張するものではありません。個人利用・非公開・自己責任です。

設計の一次ソース: [docs/research-2026-08.md](docs/research-2026-08.md)（2026-08-19）

## 構成

```
Workflow schedules（毎時 5 分 UTC）
  → RecordingSchedulerWorkflow
      → D1 から ended_at 済みかつ未成功の枠を拾う
      → RecordingJobWorkflow（1 番組 1 インスタンス）
          → RecorderContainer（単一 DO 名で直列化）
          → yt-dlp -N 10 → 音声ストリーム
          → Worker が R2 へ put（音声を Workflow 状態に載せない）
          → D1 recordings / attempts を更新
```

| パス | 役割 |
| --- | --- |
| `src/` | Worker / Workflow / Container Durable Object |
| `container/` | Python HTTP ジョブ API（yt-dlp / ffmpeg）。依存は uv |
| `migrations/0001_init.sql` | D1 スキーマ |
| `scripts/poc-local.sh` | 手元の `yt-dlp --simulate` |

オブジェクトキーに番組名は入れません。

```
radio/{station_id}/{program_id}/{yyyy}/{mm}/{yyyy-mm-ddTHHmmss}+09:00.m4a
radio/{station_id}/{program_id}/{yyyy}/{mm}/{yyyy-mm-ddTHHmmss}+09:00.json
```

## ローカル

```bash
npm install
uv --directory container sync --frozen --no-dev
npm test
./scripts/poc-local.sh 'https://radiko.jp/#!/ts/FMT/20251012140000'
npx wrangler d1 migrations apply rire --local
npx wrangler dev
```

Python 依存は `container/pyproject.toml` と `container/uv.lock` です。手元もコンテナも **uv** を使います。uv の導入は [公式のインストール手順](https://docs.astral.sh/uv/getting-started/installation/) を見てください。

`wrangler dev` は Docker が必要です（Containers）。コンテナ単体は次でも確認できます。

```bash
docker build -t rire-recorder ./container
docker run --rm -p 8080:8080 rire-recorder
curl -s http://127.0.0.1:8080/health
```

Worker HTTP（`RIRE_API_TOKEN` を付けている場合は `Authorization: Bearer ...`）:

- `POST /programs` `{ "stationId": "FMT", "title": "番組名", "id": "10002831" }`
- `POST /schedules` `{ "programId", "stationId", "startedAt", "endedAt", "timeshiftUrl" }`
- `POST /jobs` `{ "scheduleId": "...", "simulate": false }`
- `POST /scheduler/run` 手動でスケジューラを起動
- `GET /programs` `/schedules` `/recordings` `/health`

時刻は ISO-8601（例: `2025-10-12T14:00:00+09:00`）。`timeshiftUrl` は `https://radiko.jp/#!/ts/...` か share URL のみです。

## デプロイ

1. Workers Paid（Containers / 長め CPU）と R2 バケット `rire-recordings` を用意する
2. `npx wrangler d1 create rire` の ID を `wrangler.jsonc` の `database_id` に入れる
3. Timefree30 を使うなら `npx wrangler secret put RADIKO_EMAIL` と `RADIKO_PASSWORD`
4. API を閉じるなら `npx wrangler secret put RIRE_API_TOKEN`
5. `npx wrangler d1 migrations apply rire --remote`
6. `npx wrangler deploy`
7. 番組とスケジュールを POST してから、`POST /jobs` で 1 本取り、R2 に m4a が付くことを確認する
8. 問題なければ Workflow `schedules`（`5 * * * *`）に任せる

認証情報はリポジトリ、Dockerfile、ログに出さないでください。`.dev.vars.example` をコピーして `.dev.vars` を使います。

無料タイムフリーは放送終了から 7 日で radiko 側が消えます。期限切れの `pending` はスケジューラが `skipped` にします。出口 IP で 403 / Reject-Code 113 が出た場合は `GEO_REJECTED` として打ち切ります。
