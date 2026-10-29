# ツール使用詳細

AGENTS.md の「ツール使用に関するガイドライン」の詳細版。

## pnpm

- `npx` や `npm` を利用せず、`pnpm exec` や `pnpm` を使用する。
- `preinstall` の `scripts/only-pnpm.mjs` は `npm_config_user_agent` が `pnpm` と確認できる場合だけ install を許可する。値が欠落・空の場合も判定不能として停止するため、パッケージマネージャ経由で実行する。
- `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` は、指定したパッケージの指定バージョンだけ release-age gate を迂回する。例外を追加するときは対象を限定し、必要性を個別に確認する。
- `pnpm-workspace.yaml` の `overrides` では Hono を監査済みの修正版 `4.13.13`、Vite `8.1.3` を同一メジャーの修正版 `8.1.6` に固定している。依存元が指定するバージョンより優先されるため、更新時は脆弱性修正を含む版か確認する。
- Vercel Workflow `4.8.8` の依存が `@vercel/oidc@4.0.4` を要求する一方、registry mirror が同版を提供しない場合に備え、`@vercel/functions@3.10.4` の依存辺だけ `4.0.3` へ限定 override している。`@swc/core` と `cbor-extract` の install scripts は Workflow SDK の導入時も明示的に拒否する。
- Workflow SDK の本番依存で検出された脆弱性を修正するため、`undici` 7、`nanoid` 5、`zod` 4、`body-parser` 2、`qs` 6 はパッチ済み版へmajor範囲内で固定し、`devalue` は `5.9.3` に固定する。nanoid 3 など別majorの利用箇所には適用しない。
- Vitest coverage は SDK が生成する `src/app/.well-known/workflow/**` だけを集計対象から除外する。`src/workflows/**` などアプリ側の Workflow 実装は従来どおり計測する。
- ESLint も SDK が生成する `src/app/.well-known/workflow/**` を除外する。アプリ側 Workflow 実装はLint対象に含める。
- `pnpm run build` 後の `postbuild` は Workflow SDK `4.8.8` が生成する `src/app/.well-known/workflow/v1/config.json` の `steps.maxDuration` を300秒に固定する。Vercel adapter はこの値を step 関数の `maxDuration` として優先するため、送信枠の自動回収期限が実行上限を超えないようにする。SDK版・生成設定・Vercel adapterの読み込み契約が変わった場合は、スクリプトがビルドを失敗させる。上限を変更する場合は、Workflow step 関数の生成成果物で反映を検証してから pin 値と送信枠回収期限を一緒に更新する。
- Gemini送信所有権はWorkflow stepの300秒上限+60秒margin（360秒）、明示的に60秒制限されたrequest経路は60秒+60秒margin（120秒）後に限り、認識済みmarkerとVercel deployment IDを持つ所有者を次の処理が回収できる。DB時刻による回収期限のため、実行中のDB時計の前進が60秒以内であることを前提とする。旧形式・unknown・marker/deployment ID欠落の所有者は時間だけでは解放しない。`docs/gemini-rate-limit-recovery.md` に詳細と運用上の限界を記載する。
- `/api/refresh-jobs` のGET/POSTは、held jobが既知のWorkflow run IDを持つ `needs_reconciliation` 状態なら、一回だけterminal-run自動reconcileを試す。Workflowの終端状態を確認し、sourceに `executing`/`unknown` がなく、candidate batchに `pending`/`running`/`result_ready`/`unknown` がない場合だけ完了化する。候補処理の再実行はせず、terminal runでも未終端candidate batchや結果不明checkpointが残ればslotを保留する。run IDのない `enqueue_unknown` 等も自動回復しない。

## Turso schema migrations

- `pnpm run db:push` and direct `drizzle-kit push` are intentionally disabled. `drizzle-kit push` diffs the whole remote database against `src/lib/db/schema.ts` and may propose dropping remote tables that are not declared locally.
- Create an explicit migration with `pnpm run db:generate`, review its SQL, verify the target database, then apply it with `pnpm run db:migrate`. The guarded migration command loads Turso credentials from the environment or `.env.local`, checks only unapplied migrations against an additive-only allowlist (`CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, and `CREATE INDEX`), and refuses when the remote migration ledger cannot be matched to this repository.
- When the remote database has a separate migration ledger, `pnpm run db:migrate` correctly refuses to guess. To apply one reviewed additive migration in that case, run `pnpm run db:apply-additive -- <journal-migration-tag>`. This validates and applies only the named SQL file in one transaction; it never changes the shared `__drizzle_migrations` table. Record that the migration was applied separately: normal `db:migrate` may continue refusing until the shared ledger history is reconciled. Do not replay the same file through Drizzle.
- Direct `drizzle-kit migrate` is also disabled; use the guarded command. Historical migrations may contain destructive SQL, so only pending migrations are checked.
- The production drift check reports both locally declared tables missing remotely and remote tables absent from the local schema. It is read-only, skips when either Turso credential is missing, and passes its Node.js code through a quoted heredoc so shell metacharacters in the script cannot trigger command substitution. On `news-watch-ponkansh.aws-ap-northeast-1.turso.io` only, a fixed reviewed inventory of unrelated existing tables is allowed; unknown tables and the same names on any other host remain drift. It never recommends `drizzle-kit push`.

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
