# rire 調査メモ（2026-08）

radiko のタイムフリー（放送後のタイムシフト）を、**個人利用のアーカイブ**として Cloudflare 上で定期取得できるかを調べた結果です。実装コードはまだ書いていません。この文書が設計の一次ソースです。

調査日: **2026-08-19**（JST）。プラグイン最新版は同日前後の **yt-dlp-rajiko v1.13**。

---

## この文書の読み方

| 節 | 内容 |
| --- | --- |
| [1. radiko × yt-dlp（2026-08）](#1-radiko--yt-dlp2026-08) | プラグイン選定、高速 DL、プラン差、CLI |
| [2. 実現可能性の結論](#2-実現可能性の結論) | 技術的には可能。規約上の許可は別問題 |
| [3. 最大リスク](#3-最大リスク) | 壊れる点・止める点 |
| [4. 推奨アーキテクチャ](#4-推奨アーキテクチャ) | Workflow → Container → R2 / D1 |
| [5. 最小 PoC 計画](#5-最小-poc-計画) | コードを書く前の検証順 |
| [6. Dockerfile スケッチ](#6-dockerfile-スケッチ) | 文書内の例。実ファイルはまだ置かない |
| [7. Container 設計](#7-container-設計) | HTTP ジョブ API、インスタンス種別、秘密情報 |
| [8. R2 アップロード](#8-r2-アップロード) | パス規約、アップロード経路、Workflow 状態制限 |
| [9. Workflow 設計](#9-workflow-設計) | スケジューラとジョブの分割 |
| [10. Cron / schedules](#10-cron--schedules) | UTC 前提。Cron Trigger 単体は使わない |
| [11. D1 スキーマ](#11-d1-スキーマ) | programs / schedules / recordings / attempts |
| [12. 提案ディレクトリ構成](#12-提案ディレクトリ構成) | 実装時の置き場所 |
| [13. ローカル開発・テスト](#13-ローカル開発テスト) | 手元での確認手順 |
| [14. デプロイ手順](#14-デプロイ手順) | 実装後にやること |
| [付録 A. 当初の 10 問への回答](#付録-a-当初の-10-問への回答) | 調査質問の明示回答 |
| [付録 B. 出典](#付録-b-出典) | URL と確認日 |

---

## 法的な話と技術的な話（先に分ける）

**技術的には可能です。** yt-dlp-rajiko + Cloudflare Containers で、放送後のタイムフリーを高速に取得し R2 へ置く構成は成立します。

**radiko の利用規約が録音・再配布を許可している、という意味ではありません。** radiko の利用規約は一般に、録音や再配布を禁じています。プラグイン作者（garret1317）も「個人アーカイブ目的。商用利用はやめてほしい。できれば Premium に入ってほしい」と書いています。これは作者のお願いであり、radiko から法的許可が降りたわけではありません。

このプロジェクトの前提:

- **個人利用のみ。** 再配布・公開・商用利用はしない。
- **規約遵守の責任は利用者（このリポジトリの運用者）にある。**
- プラグインのエリアフリー（VPN なし・任意 IP）は、radiko のエリア制限と衝突しうる。Premium / Timefree30 を契約していても、エリア制限の解釈は利用者側の判断。
- この文書は技術調査であり、**法的許可を主張しない。**

---

## 1. radiko × yt-dlp（2026-08）

### 1.1 結論: 組み込み extractor だけでは足りない

yt-dlp 本体の Radiko extractor（`yt_dlp/extractor/radiko.py`）は `pc_html5` 認証で、`_GEO_BYPASS = False`。`area_id` が `OUT` だと geo restricted になる。Cloudflare の出口 IP（データセンター）では **HTTP 403**、レスポンスヘッダ `X-Radiko-Reject-Code: 113` が報告されている。

- yt-dlp 本体: [yt-dlp/yt-dlp#16707](https://github.com/yt-dlp/yt-dlp/issues/16707)（2026-05）
- プラグイン側: [garret1317/yt-dlp-rajiko#27](https://github.com/garret1317/yt-dlp-rajiko/issues/27)
- rajiko メンテナ（個人の見解）: 日本国外 IP ではプラグインを推奨

**Cloudflare 上では yt-dlp-rajiko を使う。** 本体 extractor 単体は採用しない。

### 1.2 推奨プラグイン: yt-dlp-rajiko（garret1317）

| 項目 | 内容 |
| --- | --- |
| 日本語公式 | https://427738.xyz/yt-dlp-rajiko/index.ja.html |
| GitHub | https://github.com/garret1317/yt-dlp-rajiko |
| PyPI | https://pypi.org/project/yt-dlp-rajiko/ |
| 最新 | **v1.13**（GitHub 2026-08-18 23:41 UTC、日本語サイト 2026-08-19 00:01 +0100、PyPI sdist 2026-08-18 23:36 UTC） |
| 必要 yt-dlp | **2025.02.19 以降** |
| ライセンス | 0BSD |
| 対象外 | NHK。NHK は yt-dlp 本体の専用サイトを使う |

**バージョン表記の注意:** 英語トップがまだ v1.11 のまま残っている可能性がある。日本語ページと PyPI は v1.13。実装時は PyPI / 日本語ページ / GitHub Releases を正とする。

メンテ状況: radiko 側の破壊的変更のたびに出している。v1.8（2025-09-14）〜 v1.13（2026-08-18）まで継続。コンテナのベースイメージはピン留めしつつ、壊れ次第上げる前提。

### 1.3 インストール

```bash
pip install yt-dlp-rajiko
# protobug も入る。r_seasons / persons / ポッドキャストに必要
```

- yt-dlp を pipx で入れている場合: `pipx inject yt-dlp yt-dlp-rajiko`
- **`.whl` 単体では protobug が入らない。** v1.13 以降、gRPC 化のため `r_seasons` / `persons` / ポッドキャストは失敗する。pip か `.bundle.zip` を使う。
- 確認: `yt-dlp -v` で `[debug] Extractor Plugins:` または `[debug] Plugin directories:` を見る。

### 1.4 高速タイムシフトはまだ動く（本プロジェクトの本命）

2025-11（v1.10）: radiko がオンデマンドの `radiko.jp` ストリームを削除。残りは「as-live」（1 時間番組なら実時間 1 時間かかる）。

回避策（プラグイン内、利用者が手動でやる必要はない）:

1. プレイリスト引数 `l=300`（5 分）と `seek` で番組をチャンク走査
2. yt-dlp の `http_dash_segments_generator` でフラグメントを都度返す
3. 進捗バーは失われる（フラグメント数が事前に分からない）が、**ダウンロード自体は速い**

経緯:

- Timefree30 はもともとオンデマンドが無く、v1.5 からチャンク回避があった
- v1.10 で通常タイムフリーにも拡大
- 公式日本語サイトは今も「素早くダウンロード」「`-N 10`」と案内している

**ライブを 1 時間ぶんリアルタイム録音する方式は採らない。** 放送終了後のタイムシフトを、チャンク回避で速く取る。

### 1.5 CLI（公式日本語ドキュメントより）

```bash
# タイムフリー（推奨）
yt-dlp 'https://radiko.jp/#!/ts/FMT/20251012140000'

# 他地域。過去 7 日はログイン不要（プラグイン）
yt-dlp 'https://radiko.jp/#!/ts/CCL/20251012230000'

# 共有 URL
yt-dlp 'https://radiko.jp/share/?sid=FMT&t=20250528142747'

# ライブ（本プロジェクトでは使わない）
yt-dlp 'https://radiko.jp/#!/live/TBS'
```

Timefree30:

```bash
yt-dlp -u メールアドレス -p パスワード 'https://radiko.jp/#!/ts/...'
# またはブラウザ Cookie。netrc の machine 名は rajiko
```

推奨オプション:

```bash
yt-dlp \
  --embed-metadata --embed-thumbnail \
  -N 10 \
  -o "%(title)s %(timestamp+32400>%Y-%m-%d_%H%M)s [%(id)s].%(ext)s" \
  --download-archive archive.txt \
  'https://radiko.jp/#!/ts/FMT/20251012140000'
```

`+32400` は JST（UTC+9）。yt-dlp の timestamp は UTC。

Cloudflare 上のオブジェクトキーには、この人間向けファイル名は使わない（[8 節](#8-r2-アップロード)）。メタデータは D1 と sidecar JSON に置く。

### 1.6 プラン差

| プラン | ログイン | エリア | 速度 |
| --- | --- | --- | --- |
| 無料タイムフリー（直近 7 日） | 不要 | プラグインは任意 IP から areafree | 速い（5 分チャンク） |
| Timefree30 / Premium | 必要（`-u/-p` または Cookie）。netrc machine `rajiko` | 同上 | 同じチャンク回避で速い（本来は as-live） |
| ライブ | 不要 | 本体 extractor は geo 問題あり | 実時間 |
| NHK | yt-dlp 本体（rajiko 対象外） | — | — |

Cookie は **7 日タイムフリー + rajiko では不要。** Timefree30 では `-u/-p` か Cookie が必要。

### 1.7 ffmpeg

必須。yt-dlp が AAC HLS を m4a にリマックスする。一部 smartstream ホストは ffmpeg に `-seekable 0 -http_seekable 0 -icy 0` が要る。プラグインは壊れた ffmpeg ホストをデフォルトでブラックリストする。コンテナに ffmpeg を入れる。

---

## 2. 実現可能性の結論

**技術: 可能。** 条件は次のとおり。

1. 実行環境は Cloudflare Containers（Python + ffmpeg + yt-dlp + yt-dlp-rajiko）。Workers 単体では yt-dlp を動かさない。
2. 取得対象は **放送終了後のタイムシフト**。ライブの実時間録音は第一選択にしない。
3. 認証は 7 日無料なら不要。Timefree30 を使うなら Worker Secrets 経由でメール/パスワード（または Cookie）をコンテナへ渡す。
4. 成果物は R2。Workflow の `step.do` 戻り値に音声バイナリを載せない。
5. 起動は Workflow binding の `schedules`（UTC cron）。HTTP 無しの Cron Trigger ハンドラに重い処理を載せない（壁時間 15 分）。

**規約: 許可された運用とは言えない。** [冒頭の分離](#法的な話と技術的な話先に分ける) を守る。実装に進む場合も「個人アーカイブ・非公開・自己責任」を README に残す。

**残リスク（技術）:** Cloudflare 出口 IP のレピュテーション。プラグインは任意 IP 向けだが、データセンター IP が将来まとめて弾かれる可能性はゼロではない。PoC の最初に、実際の CF 出口から 1 本取れるかを確認する。

---

## 3. 最大リスク

優先度の高い順。

1. **radiko API / 配信形態の変更でプラグインが壊れる。** 過去も数日〜数週間単位で追従リリースが出ている。チャンク回避（`l=300`）自体が塞がれた場合、as-live の実時間 1 時間が強制され、コンテナの `sleepAfter` とホスト再起動リスクが一気に効く。
2. **コンテナホストの予期しない停止。** 固定の最大実行時間は無いが、ホスト再起動時は SIGTERM → 最大 15 分で SIGKILL。長時間ジョブは途中終了しうる。タイムシフト高速 DL なら通常は数分で終わる想定だが、リトライと `recording_attempts` が必須。
3. **Workflow の CPU 時間。** ステップの壁時間は無制限だが CPU は Workers 制限。コンテナへの HTTP は接続中生存する。音声を Workflow 状態に載せると persisted state（Free 100MB / Paid 1GB）を食う。
4. **利用規約・エリア制限。** 技術成功 ≠ 利用許可。運用判断は利用者。
5. **データセンター IP（403 / Reject-Code 113）。** 本体 extractor では既知。プラグインでも将来のリスク。
6. **秘密情報の扱い。** radiko のメール/パスワードをリポジトリやログに出さない。コンテナ stdout に yt-dlp の認証情報を残さない。
7. **同時実行数。** 番組が重なるとコンテナ `max_instances` を超える。スケジューラは直列、または同時数を絞る。

チャンク回避が塞がれた場合のフォールバック（設計上の覚悟）:

- 実時間録音に切り替えると、1 時間番組は約 1 時間。`sleepAfter` を十分長くし、SIGTERM で部分ファイルを捨ててリトライする。
- コストと失敗率が上がるので、その時点で「続けるか止めるか」を再判断する。

---

## 4. 推奨アーキテクチャ

優先は **放送後タイムシフト**。ライブ 1 時間録音ではない。

```
Workflow schedules（binding 上の cron、UTC）
  → RecordingSchedulerWorkflow
      → D1: ended_at < now かつ未録音の due スケジュール
      → 各件: RecordingJobWorkflow
            （同時コンテナ数を抑えるなら直列）
          → Container 起動（startAndWaitForPorts）
          → POST /record { timeshiftUrl, r2Key, ... }
          → Container: yt-dlp -N 10 → /tmp → R2 へ upload
          → D1 recordings 行 + attempts 更新
```

役割:

| コンポーネント | 役割 |
| --- | --- |
| RecordingSchedulerWorkflow | 毎時（例: 各時 5 分）に due を拾い、ジョブを起動するだけ |
| RecordingJobWorkflow | 1 番組 1 インスタンス。リトライ単位 |
| Container | yt-dlp / ffmpeg の実行。HTTP ジョブ API |
| R2 | m4a と sidecar JSON |
| D1 | 番組マスタ、スケジュール、録音結果、試行履歴 |
| Worker Secrets | `RADIKO_EMAIL` / `RADIKO_PASSWORD` 等。コンテナ `envVars` へ |

番組名はパスに入れない。名前は変わるし、記号も多い。人間が読む名前は D1。

---

## 5. 最小 PoC 計画

実装リポジトリを膨らませる前に、この順で確かめる。**この文書の時点では未実施。**

1. **手元（日本または VPN 無し）**  
   `yt-dlp -N 10 --simulate 'https://radiko.jp/#!/ts/...'`  
   プラグイン読み込みと URL 解決だけ確認。
2. **手元で実 DL**  
   同じ URL を `/tmp` へ。所要時間、m4a の長さ、ffmpeg の要否を記録。
3. **Dockerfile をローカル Docker で**  
   イメージ内で同じコマンド。ネットワークと ffmpeg を確認。まだ Cloudflare に出さない。
4. **Worker + Container（ローカル `wrangler dev`）**  
   `POST /record` が動くか。R2 はまだモックでもよい。
5. **R2**  
   コンテナまたは Worker から 1 ファイル put。キー規約を守る。
6. **Workflow + D1**  
   手動 `create` で 1 ジョブ。成功したら `schedules` を付ける。

失敗したら次に進まない。特に 4 で CF 出口から 403/113 が出たら、アーキテクチャ以前の問題。

---

## 6. Dockerfile スケッチ

実ファイルはまだ置かない。実装時のたたき台。

```dockerfile
# 文書用スケッチ。本番 Dockerfile ではない。
FROM python:3.12-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp は 2025.02.19 以降。rajiko は pip（protobug 込み）
RUN pip install --no-cache-dir "yt-dlp>=2025.02.19" "yt-dlp-rajiko==1.13"

WORKDIR /app
COPY server.py /app/server.py

# ジョブ API。実装時に HTTP サーバを置く
ENV PORT=8080
EXPOSE 8080
CMD ["python", "/app/server.py"]
```

メモ:

- `yt-dlp-rajiko` はバージョンピン。radiko が壊れたら上げる。
- 認証情報はイメージに焼かない。実行時 `envVars`。
- ffmpeg 用に `basic` または `standard-1` を想定（[7.3](#73-インスタンス種別)）。
- FUSE で R2 をマウントする場合は fuse / tigrisfs 等が追加になる。初手は HTTP ストリーム upload の方が単純。

---

## 7. Container 設計

公式: Durable Object + イメージ。`Container` は `@cloudflare/containers`。`getContainer` / `getByName`。リクエスト前に `startAndWaitForPorts()`。

### 7.1 ジョブ API（案）

コンテナは常駐バッチではなく、**短い HTTP サーバ**。

`POST /record`

```json
{
  "timeshiftUrl": "https://radiko.jp/#!/ts/FMT/20251012140000",
  "r2Key": "radio/FMT/prog_xxx/2025/10/2025-10-12T140000+09:00.m4a",
  "stationId": "FMT",
  "startedAt": "2025-10-12T14:00:00+09:00",
  "endedAt": "2025-10-12T16:00:00+09:00"
}
```

処理:

1. `/tmp` に yt-dlp（`-N 10`、必要なら `--embed-metadata --embed-thumbnail`）
2. 成功したら R2 へ（[8 節](#8-r2-アップロード)）
3. JSON で `{ ok, r2Key, bytes, durationSec, extractor }` を返す。音声本体は返さない。

失敗時は非 2xx と短いエラーコード（`GEO_REJECTED` / `YTDLP_EXIT` / `UPLOAD_FAILED` 等）。パスワードをログに出さない。

### 7.2 ライフサイクル

- 固定の最大実行時間は無い（[Containers FAQ](https://developers.cloudflare.com/containers/faq/)）。
- `sleepAfter` デフォルト **10 分**。ジョブ中はアクティビティで延長される想定だが、ホスト再起動は別。
- 停止時: SIGTERM → 最大 15 分 → SIGKILL。`/tmp` の途中ファイルは消える前提で、D1 上は failed + retry。
- 想定ジョブ時間は「1 時間番組でも数分」（チャンク回避）。`sleepAfter` は `"20m"` 程度で足りる見込み。実測で調整。

### 7.3 インスタンス種別

[公式（2025-10-01）](https://developers.cloudflare.com/changelog/post/2025-10-01-new-container-instance-types/):

| 種別 | vCPU | メモリ | ディスク |
| --- | --- | --- | --- |
| lite | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |

カスタム種別は 2026-01-05 から一般利用可。下限 1 vCPU。それ未満は `lite` / `basic`。

**推奨:** 初手 `basic`。ffmpeg + 同時 `-N 10` で足りなければ `standard-1`。`lite` はメモリが厳しそう。

`max_instances` は同時録音数の上限。スケジューラ側でも直列化する。

### 7.4 秘密情報

[Environment variables and secrets](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/)

- Worker Secrets に `RADIKO_EMAIL` / `RADIKO_PASSWORD`（Timefree30 を使う場合のみ）
- Container クラスの `envVars`、または `startAndWaitForPorts({ startOptions: { envVars: { ... } } })` で渡す
- リポジトリ、Dockerfile、`wrangler.jsonc` の平文、yt-dlp ログにパスワードを書かない
- 7 日無料だけなら、これらのシークレット自体が不要

---

## 8. R2 アップロード

### 8.1 オブジェクトキー（番組向き）

人間可読の番組名はパスに入れない。

```
radio/{station_id}/{program_id}/{yyyy}/{mm}/{yyyy-mm-ddTHHmmss}+09:00.m4a
radio/{station_id}/{program_id}/{yyyy}/{mm}/{yyyy-mm-ddTHHmmss}+09:00.json
```

例:

```
radio/FMT/10002831/2025/10/2025-10-12T140000+09:00.m4a
radio/FMT/10002831/2025/10/2025-10-12T140000+09:00.json
```

- `{program_id}` は radiko の安定 ID（`r_seasons` ID など）。無ければ自前の slug。
- 時刻は **放送開始の JST**。オフセット `+09:00` をキーに含めてタイムゾーンを曖昧にしない。
- sidecar JSON には title、station、duration、yt-dlp id、ソース URL、取得日時を入れる。

### 8.2 アップロード経路（3 択）

| 方法 | 概要 | 向き |
| --- | --- | --- |
| A. コンテナ HTTP → Worker `env.BUCKET.put()` | コンテナがファイルをストリームで返し、Worker が R2 に書く | 認証を Worker に閉じられる。音声を Workflow 状態に載せないこと |
| B. コンテナから R2 S3 API | コンテナに R2 のアクセスキー | 単純。キー管理が増える |
| C. R2 FUSE マウント（2025-11） | tigrisfs / s3fs 等で `/mnt/r2` に書く | yt-dlp の `-o` を直接マウント先にもできるが、FUSE の運用が増える |

**推奨（初手）:** A または B。Workflow の `step.do` から音声 blob を **返さない**。戻りは JSON メタデータのみ。persisted state は Free **100MB** / Paid **1GB**（[Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)）。

番組は 1 時間 AAC でも数十 MB 〜 100MB 超があり得る。multipart を前提にする（Workers API の put、または S3 multipart）。単発 PUT の上限は 5 GiB だが、失敗時のやり直しを考えると multipart の方が安全。

---

## 9. Workflow 設計

### 9.1 なぜ Workflow か

- ステップ単位のリトライ
- コンテナ HTTP をステップ内で待てる（接続中は生存。ステップ壁時間は無制限、CPU は別）
- 2026-06-02 から binding に `schedules` を付けられる。別 Worker の `scheduled` が不要

Cron Trigger の `scheduled` ハンドラは壁時間 **15 分**。ここに yt-dlp を直接載せない。

### 9.2 RecordingSchedulerWorkflow

1. `step.do("list-due")`: D1 から `ended_at <= now` かつ未成功のスケジュール
2. 各行について `RecordingJobWorkflow.create(...)`、または自前で順に `step.do("record-N")`
3. 同時起動数は `max_instances` 以下

戻りは件数と ID のリスト。ファイルは持たない。

### 9.3 RecordingJobWorkflow

1. `step.do("mark-attempt")`: `recording_attempts` に running
2. `step.do("run-container")`: `getContainer` → `startAndWaitForPorts` → `POST /record`。タイムアウトは番組長より十分長く（高速 DL なら 15〜30 分で足りる想定）
3. `step.do("finalize")`: D1 `recordings` を succeeded。失敗なら attempts を failed にしてリトライ設定

`step.do` の retries はネットワーク失敗向け。radiko 403 は `NonRetryableError` にして打ち切る。

CPU: デフォルト 30 秒、必要なら wrangler の `limits.cpu_ms` を上げる。待ち時間（コンテナ I/O）は CPU に入らない。

---

## 10. Cron / schedules

Cloudflare の cron は **UTC**（[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)）。JST の壁時計が欲しい式は UTC に変換する。

推奨: 別 Cron Trigger ではなく **Workflow binding の `schedules`**。

```jsonc
{
  "workflows": [
    {
      "name": "recording-scheduler",
      "binding": "RECORDING_SCHEDULER",
      "class_name": "RecordingSchedulerWorkflow",
      "schedules": ["5 * * * *"]
    }
  ]
}
```

`5 * * * *` は **毎時 5 分（UTC）**。毎時なので JST でも「各時 5 分」と同じ。特定の JST 時刻（例: 毎日 0:05 JST）なら `5 15 * * *`（UTC）になる。

番組終了直後に取りたい場合:

- 毎時 5 分で十分（終了から最大約 65 分遅れ）
- より早くするなら `*/15` など。空振りコストは小さい（D1 の SELECT）

Wrangler が `schedules` を知らない場合は、対応版に上げる（2026-06 以降の機能）。

---

## 11. D1 スキーマ

たたき台。実装時にマイグレーションへ落とす。

```sql
-- 番組マスタ。表示名はここ（パスには使わない）
CREATE TABLE programs (
  id TEXT PRIMARY KEY,          -- radiko r_seasons id など
  station_id TEXT NOT NULL,     -- 例: FMT
  title TEXT NOT NULL,
  default_duration_min INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 繰り返し or 単発の「この枠を録る」
CREATE TABLE recording_schedules (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  station_id TEXT NOT NULL,
  -- 放送枠（JST を ISO 8601 で保存。比較は UTC に揃えてもよい）
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  timeshift_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'recording', 'succeeded', 'failed', 'skipped')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (station_id, started_at)
);

CREATE INDEX idx_schedules_due
  ON recording_schedules (status, ended_at);

-- 成功した成果物
CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES recording_schedules(id),
  program_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  r2_json_key TEXT,
  bytes INTEGER,
  duration_sec INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (schedule_id)
);

-- リトライ履歴
CREATE TABLE recording_attempts (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES recording_schedules(id),
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed')),
  error_code TEXT,
  error_message TEXT,
  workflow_instance_id TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  UNIQUE (schedule_id, attempt_no)
);
```

スケジューラの due 条件（概念）:

```sql
SELECT *
FROM recording_schedules
WHERE status IN ('pending', 'failed')
  AND ended_at <= datetime('now')  -- 保存形式に合わせて変換
ORDER BY ended_at ASC;
```

7 日を過ぎた無料枠は radiko 側で消える。古い `pending` は `skipped` にする掃除ステップを後で足す。

---

## 12. 提案ディレクトリ構成

実装時の置き場所。今は `docs/` と README のみ。

```
rire/
  README.md
  docs/
    research-2026-08.md          # 本資料
  wrangler.jsonc                 # Worker / Container / Workflow / D1 / R2
  package.json
  src/
    index.ts                     # Worker エントリ
    workflows/
      scheduler.ts
      recording-job.ts
    container.ts                 # Container クラス（Durable Object）
  container/
    Dockerfile
    server.py                    # POST /record
  migrations/
    0001_init.sql
  scripts/
    poc-local.sh                 # 手元 yt-dlp 確認用（任意）
```

秘密情報は `.dev.vars`（git 対象外）と `wrangler secret`。`.env` に radiko パスワードをコミットしない。

---

## 13. ローカル開発・テスト

### 13.1 yt-dlp 単体

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install "yt-dlp>=2025.02.19" yt-dlp-rajiko
yt-dlp -v -N 10 --simulate 'https://radiko.jp/#!/ts/FMT/20251012140000'
```

Extractor Plugins に rajiko が出ること。`--simulate` のあと、短い番組で実 DL。

Timefree30 を試す場合のみ:

```bash
yt-dlp -u "$RADIKO_EMAIL" -p "$RADIKO_PASSWORD" --simulate '...'
```

パスワードをシェル履歴に残したくなければ netrc（machine `rajiko`）か Cookie。

### 13.2 コンテナ単体

```bash
docker build -t rire-recorder ./container
docker run --rm -p 8080:8080 rire-recorder
# 別端末から POST /record（実装後）
```

### 13.3 wrangler

```bash
npx wrangler dev
# Workflow schedules はローカルで手動 create した方が分かりやすい
npx wrangler d1 execute rire --local --file=migrations/0001_init.sql
```

Cron のローカル試験は `wrangler dev --test-scheduled` があるが、本構成は Workflow `schedules` 側。ダッシュボードまたは API でインスタンスを 1 本作って確認する。

---

## 14. デプロイ手順

実装後の手順。今は実行しない。

1. Cloudflare アカウントで R2 バケット、D1、Workers Paid（Containers / 長め CPU が要るなら）を用意
2. `wrangler.jsonc` に containers / durable_objects / workflows（`schedules`）/ d1_databases / r2_buckets
3. Timefree30 を使うなら `wrangler secret put RADIKO_EMAIL` と `RADIKO_PASSWORD`
4. `npx wrangler d1 migrations apply`（リモート）
5. `npx wrangler deploy`（イメージビルド含む）
6. ダッシュボードで Container のログ、Workflow の過去実行を見る
7. 手動で `RecordingJobWorkflow` を 1 本 create し、R2 に m4a が付くことを確認してから cron を有効化
8. 失敗時は `recording_attempts.error_code` とコンテナログ。403/113 なら出口 IP 問題として切り分ける

ロールアウトでコンテナが SIGTERM される。録音中デプロイは避けるか、ジョブを短く保つ。

---

## 付録 A. 当初の 10 問への回答

1. **Cloudflare から radiko タイムフリーは取れるか?**  
   **はい。** yt-dlp-rajiko 経由。本体 extractor だけでは CF IP で足りない。

2. **メンテされているツールは?**  
   **yt-dlp-rajiko v1.13**（2026-08-18/19）。活発。radiko が壊れるたびに出している。

3. **無料 / Premium の差は?**  
   無料 7 日はログイン不要。Premium + Timefree30 はログイン。プラグインは areafree、本体は geo ロック。

4. **Cookie は必要か?**  
   7 日タイムフリー + rajiko では不要。Timefree30 は `-u/-p` または Cookie。

5. **Timefree30 は対応しているか?**  
   v1.2 から対応。高速チャンクは v1.5 から（当時 TF30 のみ）。v1.10 で通常タイムフリーにも拡大。

6. **高速 DL はまだ有効か?**  
   **はい。** 5 分チャンク回避。公式も `-N 10`。進捗バーは無いが速度は速い。

7. **ffmpeg は必要か?**  
   **はい。** AAC HLS → m4a。一部ホストは追加フラグ。コンテナに入れる。

8. **Cloudflare Containers で yt-dlp は現実的か?**  
   **はい。** Python + ffmpeg + yt-dlp をイメージに入れ、HTTP ジョブ API。`basic` または `standard-1`。

9. **データセンター IP 問題は?**  
   本体 extractor: **問題あり**（403 / Reject-Code 113）。プラグイン: 任意 IP（CF 出口含む）向け。残リスクは DC IP のレピュテーション。

10. **ボトルネックは?**  
    プラグイン破壊、コンテナホスト停止、Workflow CPU、規約、チャンク回避が塞がれた場合の実時間 1 時間（`sleepAfter` とホスト再起動）。

---

## 付録 B. 出典

確認日はいずれも **2026-08-19** 前後。

### yt-dlp / radiko

| 資料 | URL |
| --- | --- |
| yt-dlp-rajiko 日本語 | https://427738.xyz/yt-dlp-rajiko/index.ja.html |
| yt-dlp-rajiko GitHub | https://github.com/garret1317/yt-dlp-rajiko |
| Releases（v1.13, v1.10 技術詳細） | https://github.com/garret1317/yt-dlp-rajiko/releases |
| PyPI v1.13 | https://pypi.org/project/yt-dlp-rajiko/ |
| yt-dlp 本体 Radiko extractor | https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/radiko.py |
| geo / 403 報告 | https://github.com/yt-dlp/yt-dlp/issues/16707 |
| Timefree30 議論 | https://github.com/garret1317/yt-dlp-rajiko/issues/22 |

v1.10（2025-11-09）リリースノートより: オンデマンド `radiko.jp` ストリーム削除、`l=300` + `seek`、`http_dash_segments_generator`、進捗バー喪失、ダウンロードは高速のまま。

### Cloudflare

| 資料 | URL |
| --- | --- |
| Containers 概要 | https://developers.cloudflare.com/containers/ |
| Container class（getContainer, startAndWaitForPorts, sleepAfter, envVars） | https://developers.cloudflare.com/containers/container-class/ |
| FAQ（実行時間、SIGTERM、secrets） | https://developers.cloudflare.com/containers/faq/ |
| env / secrets 例 | https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/ |
| インスタンス種別 | https://developers.cloudflare.com/containers/platform-details/limits/ |
| 大型インスタンス（2025-10-01） | https://developers.cloudflare.com/changelog/post/2025-10-01-new-container-instance-types/ |
| カスタムインスタンス（2026-01-05） | https://developers.cloudflare.com/changelog/post/2026-01-05-custom-instance-types/ |
| R2 FUSE（2025-11-21） | https://developers.cloudflare.com/changelog/post/2025-11-21-fuse-support-in-containers/ |
| Workflow schedules（2026-06-02） | https://developers.cloudflare.com/changelog/post/2026-06-02-cron-workflows/ |
| Workflow の trigger | https://developers.cloudflare.com/workflows/build/trigger-workflows/ |
| Workflow limits（状態 100MB/1GB、ステップ壁時間） | https://developers.cloudflare.com/workflows/reference/limits/ |
| Workers limits（Cron 15 分、CPU） | https://developers.cloudflare.com/workers/platform/limits/ |
| Cron Triggers（UTC） | https://developers.cloudflare.com/workers/configuration/cron-triggers/ |
| R2 Workers API | https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ |

---

## 次にやること（実装ではない）

1. 手元で `--simulate` と短い実 DL（[5 節](#5-最小-poc-計画) の 1–2）
2. 問題なければ Dockerfile → Worker+Container → R2 → Workflow+D1 の順
3. 実装に入るときは、この文書の規約注意を README に残す
