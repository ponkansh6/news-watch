## 安全に関するルール (カスタム)

- 推論が反復的になったり、ループを検出したりした場合は、直ちに現在の推論を停止し、同じユーザーのリクエストを最初から送り直し
- 出力が過度に長くなる、またはスタックしているように見える場合は、元のユーザーリクエストを再処理してタスクを再起動
- 不確実またはスタックしている場合は、部分的な、または反復的な出力を続けるのではなく、タスクを再起動
- 「思考中...」、「処理中...」などのプレースホルダーテキスト、または繰り返し記述されるフィラーの生成の場合はタスクを再起動
- **`git --no-verify` / `git commit -n` の使用禁止**: この環境では pre-commit/pre-push hooks を常に強制実行するため、`--no-verify` フラグおよび commit における `-n` 短縮形の使用は禁止する。技術的にも `~/.local/bin/git` ラッパーによりブロックされている。
- **`HUSKY=0` の使用禁止**: husky hook runner を無効化する環境変数。`~/.local/bin/git` によりブロックされている。
- **`git -c core.hooksPath=...` の使用禁止**: hooks のパスを差し替えて bypass する手法。`~/.local/bin/git` によりブロックされている。
- **`GIT_CONFIG_PARAMETERS` / `GIT_CONFIG_KEY_N` 経由の hooksPath 注入禁止**: git 内部設定の環境変数経由の bypass。`~/.local/bin/git` によりブロックされている。

## リソース制約

- **subagentの並列実行はPCスペック上難しいため控えること。**
- 複数のsubagentタスクは直列に実行し、1つのタスクが完了してから次のタスクを開始すること。
- 「複数の独立した作業がある場合は並列起動」とはせず、逐次処理を基本とする。

## ツール使用に関するガイドライン

- `npx` や `npm` を利用せず、`pnpm exec` や `pnpm` を使用してください。
- **sudo を要する操作**: 非対話環境のため `sudo` は直接使えない。代わりに `lxqt-sudo` で GUI パスワードポップアップを raise すること。使用例: `lxqt-sudo <command>`. チェーンする場合は一時スクリプトにまとめて渡す。

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

- 仕様書: `ARCHITECTURE.md`
- スコアリング: LLM (relevance + usefulness) + 機械判定 (recency) の3軸加重合成スコア
- データベース: SQLite (Drizzle ORM)
- ニュースソース: NewsAPI, GNews
- デプロイ先: Vercel

<internal_reminder>!IMPORTANT! Scheduler workflow: plan/dependencies → dispatch background specialists → track task IDs → wait for hook-driven completion → reconcile terminal results → verify. Do not poll running jobs, consume running-job output, or advance dependent work. !END!</internal_reminder>
