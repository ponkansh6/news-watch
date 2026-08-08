# ツール使用詳細

AGENTS.md の「ツール使用に関するガイドライン」の詳細版。

## pnpm

- `npx` や `npm` を利用せず、`pnpm exec` や `pnpm` を使用する。

## sudo（非対話環境）

- 非対話環境のため `sudo` は直接使えない。代わりに `lxqt-sudo` で GUI パスワードポップアップを raise する。使用例: `lxqt-sudo <command>`. チェーンする場合は一時スクリプトにまとめて渡す。

## `rtk` CLI プロキシ

この環境では `rtk` というCLIプロキシが `/home/shunki/.local/bin/rtk` にインストールされている。`rtk` はコマンド出力をLLM向けにフィルタリング・要約するラッパーであり、以下の挙動に注意すること。

- **`rtk <command>` は出力をトークン最適化する**: ビルドログやテスト出力が自動的に短縮・グループ化される。エラーの詳細や警告の全文が必要な場合は生出力を使うこと。
- **生出力が必要な場合**: `rtk run <command>` を使用する（フィルタリングなし、素の出力）。
  - 例: `rtk run pnpm exec next build`（Next.jsビルドの完全なログを取得）
  - 例: `rtk run pnpm exec vitest run`（テストの完全な出力を取得）
- **未知のツール・コマンドで出力が期待と異なる場合**: まずそのツールの仕様を調査すること。`rtk` 自体のヘルプは `rtk --help` で確認可能。繰り返し同じコマンドを再実行せず、`@explorer` や `@librarian` に委譲して仕様を確認してから使用する。
- **`rtk` の主要サブコマンド**:
  - `rtk run <cmd>`: 生実行（フィルタリングなし）
  - `rtk proxy <cmd>`: フィルタリングなし＋使用状況追跡
  - `rtk pipe`: 標準入力から読み取りフィルタリング
  - `rtk next` / `rtk vitest` / `rtk git` など: 各コマンドのラッパー（出力最適化あり）

## スモークテスト（scripts/smoke-test.sh）

- `pnpm build && pnpm start` 後に `/` を curl し、RSC レンダリングエラー（cookie 書き込み等）を検出する。
- 実行: `bash scripts/smoke-test.sh`（pre-push で `src/` 変更時に自動実行）
- 判定は HTTP 200 ではなく、本文に `E{"digest"` が無いこと・ログに `Cookies can only be modified` が無いこと・`News Watch` 見出しが描画されること。

## CI（.github/workflows/ci.yml）

- GitHub Actions で lint / type-check / vitest / カバレッジ Tier / spec 参照 / スモークテストを実行。
- フックは `--no-verify` で迂回できるため、CI が非迂回の検査層となる。
