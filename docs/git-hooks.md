# Git Hooks 対処ルール詳細

AGENTS.md の「Git Hooks の対処ルール」の詳細版。コミット / push 時にフックの warning や error が発生した場合は本ファイルを参照する。`--no-verify` / `HUSKY=0` での bypass は禁止。

## pre-push warning: `src/ files changed but tests/ was NOT updated`

- **発生条件**: `src/` 配下のファイルを変更してコミットし、push したときに、対応する `tests/` 配下のテストファイルが変更・追加されていない場合に出力される。
- **対処**: 変更内容に応じて以下のいずれかを行う:
  - **新規モジュールを追加した場合**: `tests/` に対応するユニットテストを作成する（例: `src/lib/news/xtech.ts` → `tests/news/xtech.test.ts`）
  - **既存モジュールに変更を加えた場合**: 既存テストケースを確認し、必要に応じてテストを追加・更新する
  - **テスト不要と判断した場合**: 該当するテストファイルにテストケースを追加するか、既存テストが変更をカバーしていることを確認する（例: 設定変更のみ、型定義のみの変更など）
- **注意**: warning が表示されても push 自体は成功するが、テスト欠落のシグナルとして必ず対処すること。push 完了後に改めてテストを追加し、別コミットとして push してもよい。

## pre-push のブロックチェック詳細

いずれかが error で終了すると push がブロックされる。

1. **`scripts/check-spec-refs.sh`** — spec.md 内の `src/` / `tests/` ファイル参照が実在するか検証。腐敗した参照（stale reference）があると失敗する。
   - 対処: spec.md の参照と実際のファイルパスを同期させる。
2. **`pnpm exec vitest run tests/db/schema-consistency.test.ts`** — ローカル in-memory DB でのスキーマ整合性テスト。
   - 対処: `src/lib/db/schema.ts` とマイグレーション / テストの同期を確認する。
3. **カバレッジ段階検証**（`src/` 変更時のみ実行・約30秒）— `vitest run --coverage` 後に `node scripts/check-coverage-tiers.mjs` を実行し、spec.md §7.1 のティア別目標（Tier 1: 95% 〜 Tier 6: 65%）を達成しているか検証する。
   - 対処: 未達のモジュールにテストを追加する。検証コマンド: `pnpm exec vitest run --coverage && node scripts/check-coverage-tiers.mjs`
4. **`pnpm exec eslint src/`** — Server Action 境界の静的検査（`@sbougerel/next-use-client-boundary/props-must-be-serializable` が RSC→Client 境界の非シリアライズ可能 props を検出）。
   - 対処: エラーを修正するか、意図的な場合は eslint-disable コメントに理由を添える。
5. **`bash scripts/smoke-test.sh`**（`src/` 変更時のみ・約30秒）— `pnpm build && pnpm start` 後に `/` を curl し、本文に RSC エラーダイジェスト（`E{"digest"`）や `Cookies can only be modified` が無いことを検証。HTTP 200 は成功判定に使わない（壊れた状態でも 200 が返るため）。
   - 対処: ビルドエラーや RSC レンダリングエラーを修正する。
6. **本番スキーマ drift 検出**（`.env.local` に Turso 認証情報がある場合のみ実行）— `scripts/check-prod-schema.sh` が本番 Turso DB と `src/lib/db/schema.ts` のスキーマを比較し、未適用のマイグレーションを検出する。
   - 対処: `pnpm exec drizzle-kit push` で本番スキーマを最新化する。

## pre-commit warning: `spec.md` 未更新

- **発生条件**: `src/` または `tests/` 配下を変更したコミットを作成しようとしたとき、`openspec/specs/news-watch/spec.md` が更新されていない場合に出力される。
- **対処**: 変更内容を spec.md に反映する。具体的には以下を確認する:
  - 新規モジュールを追加した場合 → `Technology Stack` のソース一覧に追記
  - 既存モジュールに変更を加えた場合 → 該当する仕様・データモデル・アーキテクチャ記述を最新化
  - 環境変数を追加/削除した場合 → 環境変数のセクションを更新
- spec.md はプロジェクトの設計意図を文書化する唯一の仕様書であり、変更との乖離は保守性を損なうため、必ず同期すること。

## pre-commit の実行内容と error 時の対処

pre-commit は以下を順に実行する:

1. `pnpm run lint:fast` — oxlint による静的解析
2. `pnpm exec tsgo --noEmit` — TypeScript 型チェック
3. `pnpm exec lint-staged` — ステージングファイルへの自動修正・関連テスト実行
   - `*.{ts,tsx}` → `oxfmt --write` + `vitest related --passWithNoTests`（関連テストが失敗すると error）
   - `*.{js,jsx,json,md,mjs,cjs}` → `oxfmt --write`
4. `bash scripts/check-spec-update.sh` — spec.md 未更新の warning（ブロックしない）

- **warning 全般**: lint-staged が oxfmt の自動修正を行った場合、修正ログや警告が出力されることがある。これらは原則自動対処されるため、手動介入は不要。
- **error 時**: 1〜3 のいずれかが **error** で終了した場合はコミットがブロックされる。エラーメッセージを読み、原因を特定して修正してから再コミットすること。
