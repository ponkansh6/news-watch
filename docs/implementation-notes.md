# 実装ノート: Phase 2 記事体験（記事カード・スコア表示）

> 更新日: 2026-08-08
> 対象: `src/components/article/*`、`src/components/news/*`、`src/lib/ui/score.ts`
> 関連計画: [shared-plan/04-article-experience.md](../shared-plan/04-article-experience.md)

## 1. 概要

メイン画面（`/`）の「スコアリング済み記事」を構成するコンポーネント群の実装記録。
`src/app/article-list.tsx` / `src/app/news-section.tsx` から
`src/components/article/*` / `src/components/news/*` への再編と、
スコア内訳の可視化（Popover）を実装した。

**お気に入り機能（要約を 5 回タップする隠しトグル）は現状維持**とし、今回の変更では
挙動を変更していない。

## 2. ファイル構成

```
src/components/article/
├── article-list.tsx      # 記事リスト + 5回タップのお気に入りトグル + トースト
├── article-card.tsx      # 記事カード 1 件分（`<article>` 要素）
├── article-skeleton.tsx  # スケルトンリスト（デフォルト 5 件）
└── score-popover.tsx     # スコア表示ボタン + 内訳 Popover（ScoreBreakdown）

src/components/news/
└── news-section.tsx      # 「スコアリング済み記事」セクション（リフレッシュ制御）

src/lib/ui/
└── score.ts              # スコアティア判定の純関数
```

旧配置 `src/app/article-list.tsx` / `src/app/news-section.tsx` は削除済み。

## 3. 各コンポーネントの実装内容

### 3.1 `src/lib/ui/score.ts` — スコアティア判定（純関数）

```ts
export type ScoreTier = "high" | "mid" | "low" | "none";

export function scoreTier(score: number | null): ScoreTier {
  if (score === null) return "none";
  if (score >= 8) return "high";
  if (score >= 5) return "mid";
  return "low";
}

export const SCORE_TIER_LABEL: Record<ScoreTier, string> = {
  high: "高スコア",
  mid: "中スコア",
  low: "低スコア",
  none: "未スコア",
};
```

- UI から独立した純関数のため単体テストしやすい（Tier 5 のカバレッジ負荷を低減）。

### 3.2 `src/components/article/score-popover.tsx` — スコア表示

- **`ScorePopover`**: スコア表示ボタン + 内訳 Popover。
  - `score === null` のときは `--` の固定表示（ボタンなし）。
  - `score` は `toFixed(1)` で表示（例: `8.0`）。
  - `aria-label="スコア ${score} の内訳を表示"`。
  - tier ごとに色を変える（`text-score-high` / `mid` / `low`）。
- **`ScoreBreakdown`**: 3 指標を横バー + 重み表記で表示。

```
関連性   ████░░░░░░  6.2   × 20%
有用性   ████████░░  8.1   × 50%
新しさ   ███████░░░  7.4   × 30%
─────────────────────────────
合成                  7.6
```

### 3.3 `src/components/article/article-card.tsx` — 記事カード 1 件

Props（実 DB の `ArticleListRow` フィールドをフラットに受ける）:

| prop                                             | 型                 | 説明                                                 |
| ------------------------------------------------ | ------------------ | ---------------------------------------------------- |
| `id`                                             | `string \| number` | 記事 ID（お気に入りトグルのキー）                    |
| `title`                                          | `string`           | タイトル（`<h3>` → リンク・`target="_blank"`）       |
| `url`                                            | `string`           | ソース URL                                           |
| `sourceName` / `sourceId` / `source`             | `string \| null`   | ソース表示名（優先: sourceName > sourceId > source） |
| `publishedAt`                                    | `string`           | 公開日時（`<time>`・`ja-JP` 表記）                   |
| `summary`                                        | `string \| null`   | 要約（2 行クランプ）                                 |
| `score` / `relevance` / `usefulness` / `recency` | `number \| null`   | スコア関連                                           |
| `keywordLabel`                                   | `string \| null`   | キーワード（`Badge variant="secondary"` で表示）     |
| `reason`                                         | `string \| null`   | スコア理由（Tooltip ボタン `ⓘ` に格納）              |
| `onPointerDown`                                  | `(e) => void`      | 要約エリアの 5 回タップ検知用                        |

- ルートは `<li>` で、内部に `<article>` + `Card`（shadcn）。
- **要約エリア（`select-none touch-manipulation` の div）に `onPointerDown` を付与**。
  ここが 5 回タップのお気に入りトグル領域。
- 左に tier バー（色覚に依存しない冗長符号化）、右にタイトル・要約・メタ。メタは Separator で区切られた 1 行（ソース・日時・キーワード・reason）。

### 3.4 `src/components/article/article-list.tsx` — 記事リスト + お気に入りトグル

Export: `ArticleList`（名前付き + default）、`Article` / `ArticleListRow` 型、`SkeletonList`。

- `type Article = ArticleListRow`（`@/lib/db/query/article-queries` の実型を再 export）。
- 記事ごとに `ArticleCard` を描画し、`onPointerDown={() => handleTap(article.id)}` を渡す。

**お気に入りトグル（現状維持の隠し機能）**:

```
handleTap(articleId):
  clickCountsRef[articleId].count += 1
  5 回到達 → toggleFav(articleId) を呼び、カウントリセット
  4 秒以内に再タップが無ければカウントリセット（4,000ms タイムアウト）
```

`toggleFav` は `POST /api/favorites/toggle` に `{ articleId }` を送信し、
レスポンスの `favorited` に応じてトーストを表示:

- `true` → 「お気に入りに登録しました」
- `false` → 「お気に入りを解除しました」
- HTTP エラー → 「お気に入りの更新に失敗しました (status)」
- 不正応答 → 「サーバーからの応答が不正です」

トーストは固定表示（`role="alert"`、閉じるボタン `aria-label="閉じる"`）、5 秒で自動消滅。

### 3.5 `src/components/article/article-skeleton.tsx` — スケルトン

- `SkeletonList` は **デフォルト 5 件**。
- 各カードは `<article>` 要素でラップ（`role="status"` / `aria-label="記事を読み込み中"`）。

### 3.6 `src/components/news/news-section.tsx` — 「スコアリング済み記事」セクション

- ヘッダー: 「スコアリング済み記事」+ 件数サフィックス。
  - 更新中: `(更新中...)`
  - 通常: `(N件)`
- `isFiltering` 中は「フィルタリング中...」インジケータを表示。
- **リフレッシュ制御**（`useRefresh` と連携）:
  - `isRefreshing` 中は `SkeletonList`（5 件）を表示。
  - 記事の **ID 差分**（`prevIdsRef` と現在の ID 集合を比較）で新着を検知したら
    `setRefreshing(false)`。参照の等価性ではなく ID 比較なので、
    RSC が同じデータを新しい参照で返しても誤って解除しない。
- 記事 0 件: 破線ボーダーの空状態（「まだ記事がありません」+ 説明文 / `emptyMessage`）。
- 記事あり: `ArticleList` を描画。

## 4. リフレッシュライフサイクル（解除経路）

`fetch-button.tsx` と連携した 3 系統の解除:

| 経路               | タイミング                                       | 実装                                       |
| ------------------ | ------------------------------------------------ | ------------------------------------------ |
| ID 差分            | 新着記事が届いた時                               | `news-section.tsx` の `useEffect`          |
| 5 秒フォールバック | API 成功後、新着 ID が現れない場合（saved=0 等） | `fetch-button.tsx` の `refreshFallbackRef` |
| 30 秒セーフティ    | 上記がどちらも発火しない場合                     | `fetch-button.tsx` の `isRefreshing` 監視  |

## 5. 消費側のページ

- `src/app/page.tsx`: `<NewsSection articles={scored} />`（`getScoredArticlesCached` の結果を渡す）
- `src/app/bookmarks/page.tsx`: `<ArticleList articles={articles} />`（お気に入り一覧）

## 6. テストと検証

対象テスト（`tests/components/`、`tests/integration/`）:

| テスト                          | 検証内容                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ArticleList.test.tsx`          | タイトル/ソース/スコア(`8.0`)/要約表示、null スコアの `--`、リンク属性、スコア内訳 Popover の表示      |
| `FavoriteArticleList.test.tsx`  | 5 回タップで `POST /api/favorites/toggle`、4 回未満は不発火、4,000ms タイムアウト、成功/エラートースト |
| `NewsSection.test.tsx`          | ヘッダー・件数、スケルトン、空状態、フィルタ中表示、記事順序、ID 差分によるリフレッシュ解除            |
| `FetchButton.test.tsx`          | 取得フロー、失敗表示、リフレッシュライフサイクル（saved=0 のフォールバック解除、新着到着での解除）     |
| `ArticleCard.test.tsx`          | 必須フィールド欠落時の表示（`source` フォールバック、`--`）                                            |
| `ScorePopover.test.tsx`         | null スコアの `--`、aria-label、内訳表示（関連性/有用性/新しさ/合成）                                  |
| `display-after-scoring.test.ts` | 取得→タグ付け→スコアリング→表示の E2E 契約                                                             |

**検証結果（2026-08-08 時点）— 更新**:

- 全テスト: **326 passed / 2 skipped（63 ファイル）** ✅
- 型チェック: `tsgo --noEmit` クリーン ✅
- リント: oxlint エラーなし（警告のみ・既存） ✅
- スキーマ整合性: `tests/db/schema-consistency.test.ts` 5 テスト通過 ✅
- カバレッジ段階検証: 全ティア目標達成（Tier 1: 100% / Tier 5: 92.09%） ✅
- spec.md 参照検証: 強化版スクリプトで腐敗パス 3 件を検出・修復済み ✅

## 7. 経緯メモ（この実装に至った経緯）

1. Phase 0/1 で shadcn/ui 基盤とアプリシェルを導入。
2. Phase 2 でスコア内訳の Popover 化を委譲実装（fix-3 / fix-4）。
3. fix-4 がスコープを逸脱し、`article-list` / `article-card` / `news-section` を
   `novelty` / `breakdown` / `keywords` 等の誤フィールドと「傾向分析モード切替」で書き換え、
   お気に入り機能を破壊。
4. 元実装（`git show HEAD:src/app/article-list.tsx` 等）から修復。
   お気に入り機能（5 回タップ・トースト）とリフレッシュ制御を復元し、
   スコア表示は Popover 方式を維持。
