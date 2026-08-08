## 安全に関するルール

- 推論が反復・ループ・スタックしている場合、またはプレースホルダー（「思考中...」等）や繰り返しのフィラー出力が続く場合は、直ちに停止し同じユーザーリクエストを最初から再処理すること。部分的な出力を継続しないこと。

## Git Hooks の対処ルール

Husky + lint-staged により pre-commit / pre-push フックが強制実行される。**error で終了するチェックは push / commit をブロックする**ため必ず修正すること。warning はブロックしないが、テスト欠落・仕様乖離のシグナルとして必ず対処すること。

**フックの bypass は禁止**: `git --no-verify` / `git commit -n` / `HUSKY=0` / `git -c core.hooksPath=...` / `GIT_CONFIG_PARAMETERS`・`GIT_CONFIG_KEY_N` 経由の hooksPath 注入はすべて禁止。技術的にも `~/.local/bin/git` ラッパーによりブロックされている。詳細な対処手順は `docs/git-hooks.md` を参照。

### pre-push のブロックチェック

1. **`scripts/check-spec-refs.sh`** — spec.md 内の `src/` / `tests/` ファイル参照の実在検証。腐敗した参照があると失敗 → spec.md の参照と実パスを同期する。
2. **`pnpm exec vitest run tests/db/schema-consistency.test.ts`** — ローカル in-memory DB でのスキーマ整合性 → `src/lib/db/schema.ts` とマイグレーション / テストを同期する。
3. **カバレッジ段階検証**（`src/` 変更時のみ・約30秒）— spec.md §7.1 のティア別目標（Tier 1: 95% 〜 Tier 6: 65%）達成を検証 → 未達モジュールにテスト追加。ローカル検証: `pnpm exec vitest run --coverage && node scripts/check-coverage-tiers.mjs`
4. **本番スキーマ drift 検出**（`.env.local` に Turso 認証がある場合のみ）— `scripts/check-prod-schema.sh` が本番 Turso DB と `schema.ts` を比較 → `pnpm exec drizzle-kit push` で本番スキーマを最新化する。

### pre-commit の実行内容

1. `pnpm run lint:fast` — oxlint による静的解析
2. `pnpm exec tsgo --noEmit` — TypeScript 型チェック
3. `pnpm exec lint-staged` — `*.{ts,tsx}` → `oxfmt --write` + `vitest related --passWithNoTests`（関連テスト失敗で error）/ `*.{js,jsx,json,md,mjs,cjs}` → `oxfmt --write`
4. `bash scripts/check-spec-update.sh` — spec.md 未更新の warning（ブロックしない）

- **docs/ との同期**: フック実装（`.husky/`・`scripts/check-*.sh`）やツール構成を変更した場合は、`docs/git-hooks.md`・`docs/tooling.md` も必ず更新する。

## リソース制約

- **subagent 並行実行(最大3つ)**: 同時に実行するエージェントは最大3つまで。

## ツール使用に関するガイドライン

- `npx` や `npm` を利用せず、`pnpm exec` や `pnpm` を使用してください。
- **sudo を要する操作**: 非対話環境のため `sudo` は直接使えない。代わりに `lxqt-sudo` で GUI パスワードポップアップを raise する。使用例: `lxqt-sudo <command>`. チェーンする場合は一時スクリプトにまとめて渡す。
- **`rtk` CLI プロキシ**（`~/.local/bin/rtk`）: コマンド出力をトークン最適化するラッパー。エラー詳細が必要な場合は `rtk run <command>` で生出力を取得する。詳細は `docs/tooling.md` を参照。

## 委譲に関するルール

- Orchestratorは自らコマンド実行を行わない。
- orchestratorが自ら直接編集や探索を行うのではなく、以下の判断基準に従って各agentに積極的に委譲すること：
  - **コード探索・ファイル検索・ファイル内容の読み取り** → `@explorer` に委譲（可能な限りorchestrator自身での `read` を避け、探索・要約を任せること）
  - **外部ライブラリ調査** → `@librarian` に委譲
  - **アーキテクチャ判断・コードレビュー・複雑なデバッグ** → `@oracle` に委譲
  - **UI/UXデザイン・見た目の実装** → `@designer` に委譲
  - **明確な実装作業（複数ファイル跨ぎ含む）** → `@fixer` に委譲
- 単一ファイルの軽微な編集以外は、まず「この作業を委譲できるagentがいるか？」を検討してから実行に移ること
- `@fixer` への委譲時は、自分が既に持っているコンテキスト（ファイル内容など）をpromptに含めて再読込コストを削減すること

## 実行モードに関する指示

- ToDoタスクを実行する際は、各ステップごとにユーザーに「続けますか？」などの確認を求めず、最後まで一括して自律的に実行してください。
- 軽微な修正や次のステップへの移行は、ユーザーの明示的な承認を待たずに連続してツール（ファイル編集、コマンド実行など）を呼び出してください。
- すべてのプロセスが完了するか、重大な競合・エラーが発生して進行できない場合のみ、最終結果とともに確認を求めてください。
- ToDoの実行という指示は、全ステップの自動実行に対する事前承認を意味します。

## プロジェクト知識

技術スタック・アーキテクチャ・スコアリング・データモデル・環境変数などの詳細は、
仕様書 `openspec/specs/news-watch/spec.md` を唯一の参照先とする。
AGENTS.md には重複記載しない（乖離防止）。変更時は spec.md を必ず更新すること
（pre-commit フック `scripts/check-spec-update.sh` が未更新を警告する）。

<internal_reminder>!IMPORTANT! Scheduler workflow: plan/dependencies → dispatch background specialists → track task IDs → wait for hook-driven completion → reconcile terminal results → verify. Do not poll running jobs, consume running-job output, or advance dependent work. !END!</internal_reminder>
