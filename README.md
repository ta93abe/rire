# rire

radiko のタイムフリーを、個人利用のアーカイブとして Cloudflare 上で定期取得するための実験リポジトリです。

**いまは調査メモだけです。** Worker / Workflow / Container の本番コードはまだありません。

- 調査・設計: [docs/research-2026-08.md](docs/research-2026-08.md)（2026-08-19）
- 技術的には yt-dlp-rajiko + Cloudflare Containers で可能、という結論
- radiko の利用規約上の許可を主張するものではありません。個人利用・自己責任

実装に進む前に、上記ドキュメントの PoC 計画（手元の `yt-dlp --simulate` から）を先にやってください。
