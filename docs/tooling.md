# ツール使用詳細

AGENTS.md の「ツール使用に関するガイドライン」の詳細版。

## pnpm

- `npx` や `npm` を利用せず、`pnpm exec` や `pnpm` を使用する。
- `preinstall` の `scripts/only-pnpm.mjs` は `npm_config_user_agent` が `pnpm` と確認できる場合だけ install を許可する。値が欠落・空の場合も判定不能として停止するため、パッケージマネージャ経由で実行する。
- `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` は、指定したパッケージの指定バージョンだけ release-age gate を迂回する。例外を追加するときは対象を限定し、必要性を個別に確認する。
- `pnpm-workspace.yaml` の `overrides` では Hono を監査済みの修正版 `4.13.13`、Vite `8.1.3` を同一メジャーの修正版 `8.1.6` に固定している。依存元が指定するバージョンより優先されるため、更新時は脆弱性修正を含む版か確認する。
- Vercel Workflow `4.8.8` の依存が `@vercel/oidc@4.0.4` を要求する一方、registry mirror が同版を提供しない場合に備え、`@vercel/functions@3.10.4` の依存辺だけ `4.0.3` へ限定 override している。`@swc/core` と `cbor-extract` の install scripts は Workflow SDK の導入時も明示的に拒否する。
- Vitest coverage は SDK が生成する `src/app/.well-known/workflow/**` だけを集計対象から除外する。`src/workflows/**` などアプリ側の Workflow 実装は従来どおり計測する。

## sudo（非対話環境）

- 非対話環境のため `sudo` は直接使えない。代わりに `lxqt-sudo` で GUI パスワードポップアップを raise する。使用例: `lxqt-sudo <command>`. チェーンする場合は一時スクリプトにまとめて渡す。

## `rtk` CLI プロキシ

この環境では `rtk` というCLIプロキシが `/home/shunki/.local/bin/rtk` にインストールされている。`rtk` はコマンド出力をLLM向けにフィルタリング・要約するラッパーであり、以下の挙動に注意すること。

- **`rtk <command>` は出力をトークン最適化する**: ビルドログやテスト出力が自動的に短縮・グループ化される。エラーの詳細や警告の全文が必要な場合は生出力を使うこと。
- **生出力が必要な場合**: `rtk run <command>` を使用する（フィルタリングなし、素の出力）。
  - 例: `rtk run pnpm run build`（Webpackを使う本番ビルドの完全なログを取得）
  - 例: `rtk run pnpm exec vitest run`（テストの完全な出力を取得）
- **未知のツール・コマンドで出力が期待と異なる場合**: まずそのツールの仕様を調査すること。`rtk` 自体のヘルプは `rtk --help` で確認可能。繰り返し同じコマンドを再実行せず、`@explorer` や `@librarian` に委譲して仕様を確認してから使用する。
- **`rtk` の主要サブコマンド**:
  - `rtk run <cmd>`: 生実行（フィルタリングなし）
  - `rtk proxy <cmd>`: フィルタリングなし＋使用状況追跡
  - `rtk pipe`: 標準入力から読み取りフィルタリング
  - `rtk next` / `rtk vitest` / `rtk git` など: 各コマンドのラッパー（出力最適化あり）

## スモークテスト（scripts/smoke-test.sh）

- `pnpm run build`（Webpack）と `pnpm start` の後に `/` を curl し、RSC レンダリングエラー（cookie 書き込み等）を検出する。Vercelの既定ビルドも `package.json` の `build` スクリプトを使う。
- 実行: `bash scripts/smoke-test.sh`（pre-push で `src/` 変更時に自動実行）
- 判定は HTTP 200 ではなく、本文に `E{"digest"` が無いこと・ログに `Cookies can only be modified` が無いこと・`News Watch` 見出しが描画されること。
- ポート占有の事前チェック: 起動前に `ss -tlnp` で `SMOKE_PORT`（既定 3100）の LISTEN を検出したら即座に失敗する。`pnpm start` は `next-server` を子プロセスとして生成するため、過去の実行で孤児化したサーバーが残っていると**古いビルドに対して検証して偽の失敗**（`page did not render`）が出る。`lsof -i :3100` で確認し、`pkill -f next-server` で掃除すること。
- 孤児プロセスの防止: サーバーは `setsid` で新規プロセスグループとして起動し、終了時（trap）にプロセスグループ単位（`kill -- -$PID`）で kill する。`next-server` が孤児として残りポートを占有することを防ぐ。

## CI（.github/workflows/ci.yml）

- GitHub Actions で lint / type-check / vitest / カバレッジ Tier / spec 参照 / スモークテストを実行。
- フックは `--no-verify` で迂回できるため、CI が非迂回の検査層となる。
