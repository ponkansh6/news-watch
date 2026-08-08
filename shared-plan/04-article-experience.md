# 04. 記事体験の再設計（`/`）

このアプリの価値は「LLM がスコアを付けた記事リスト」である。
その価値が最も伝わる形に情報設計を組み直す。

## 4.1 現状のカード構造

```
┌──────────────────────────────────────────────┬──────┐
│ タイトル（リンク）                             │      │
│ 要約 2 行 ← ここを 5 回タップで お気に入り     │ [8]  │  ← title 属性に内訳
│ ソース名  日付  [キーワード]  理由(italic)      │      │
└──────────────────────────────────────────────┴──────┘
```

問題（[01](./01-current-state.md) 参照）:

- スコアの根拠が `title` 属性のみ（D）
- ダークモードで白カード（B）
- メタ情報が 1 行にすべて詰まっており、`reason` が長いと折り返して読みにくい

お気に入り関連（5 回タップの隠しトグル / 登録状態の非表示）は **現状維持が決定**。
本プランの対象外とし、以下では扱わない（[01 §C](./01-current-state.md)）。

## 4.2 新しいカード構造

```
┌──────┬────────────────────────────────────────────┐
│      │ タイトル（リンク・2行クランプ）              │
│ [8.4]│ 要約（2行クランプ・muted）                   │
│  ↑   │ ─────────────────────────────────────────── │
│ Popover│ Zenn · 2026/08/08 · [React] · 理由 ⓘ      │
└──────┴────────────────────────────────────────────┘
```

### 変更点

| 項目         | 変更                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| スコアの位置 | 右 → **左**。視線の起点に価値指標を置く                                    |
| スコアの内訳 | `title` → **Popover**（クリック/Enter で開く、タッチ対応、キーボード対応） |
| お気に入り   | **現状維持**（5 回タップの隠しトグルを維持。変更しない）                   |
| メタ情報     | `Separator` 区切りの 1 行。`reason` は Tooltip 付きの `ⓘ` に格納           |
| カード全体   | shadcn `Card` + トークン化された色                                         |
| ホバー       | `transition-all` → `transition-colors` + `hover:bg-accent/40`              |

### スコア表示

`src/lib/ui/score.ts` に純関数として切り出す（テストしやすく、Tier 5 の負荷を下げる）:

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

**色だけに頼らない**（現状 `article-list.tsx:39-44` は色のみ）:

- 数値そのものを大きく表示（`font-mono tabular-nums`）
- `aria-label={`スコア ${score}、${SCORE_TIER_LABEL[tier]}`}`
- tier ごとに左端の縦バー太さ/塗り面積を変える（色覚に依存しない冗長符号化）

```tsx
<Popover>
  <PopoverTrigger asChild>
    <button className="… focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`スコア ${score} の内訳を表示`}>
      <span className="font-mono text-lg tabular-nums">{score.toFixed(1)}</span>
    </button>
  </PopoverTrigger>
  <PopoverContent className="w-64">
    <ScoreBreakdown relevance={…} usefulness={…} recency={…} total={score} />
  </PopoverContent>
</Popover>
```

`ScoreBreakdown` は 3 指標を**横バー + 重み表記**で見せる（現状は改行区切りのテキスト）:

```
関連性   ████░░░░░░  6.2   × 20%
有用性   ████████░░  8.1   × 50%
新しさ   ███████░░░  7.4   × 30%
─────────────────────────────
合成                  7.6
```

これはアプリの中核である「なぜこの記事が上位なのか」を初めて可視化する。

### お気に入りトグル

**現状維持（変更しない）。** 5 回タップの隠しトグルをそのまま残す。

- `src/app/article-list.tsx:91-110` の `handleTap` / `:187-192` の `onPointerDown` は**触らない**
- 明示的な `FavoriteButton` / `useFavorite` / `ArticleListRow.isFavorited` は導入しない
- 登録状態の非表示（トーストが消えると分からない）も現状のまま
- `spec.md §9 Hidden Features` の記述も**変更しない**

> キーボード操作が不可能である点は既知の制約として許容する（[01 §C](./01-current-state.md)）。
> この制約を解消したい場合は、本プランとは別のタスクとして検討する。

### キーワードチップ

現状（`article-list.tsx:56-74`）はハッシュから 8 色を割り当てているが、
`bg-*-50` はダークモードで完全に破綻し、コントラストも未検証。

方針: **単色の `Badge variant="secondary"` に統一する**。
色でキーワードを区別する必要性が薄い（1 記事に 1 キーワードしか出ていない）。
どうしても色分けが要るなら、`oklch` で明度を固定した 6 色パレットを
`--color-tag-{1..6}` としてトークン化し、ライト/ダーク両方で検証する。

## 4.3 ソース選択とツールバー

### 現状の問題（[01 §G](./01-current-state.md)）

localStorage / URL / サーバー searchParams の 3 重管理。マウント後の
`router.replace()`（`fetch-button.tsx:40-47`）でちらつく。

### 方針: URL を単一の情報源にする

1. **`localStorage` からの初期化と、マウント時 `router.replace()` を廃止**
2. サーバー側 `page.tsx` が `searchParams.source` を唯一の真実として扱う
3. 「前回のソースを覚える」体験は **Cookie** で実現する
   — サーバーで読めるため初回描画から正しい値が出せ、ちらつきが原理的に起きない

```tsx
// src/app/page.tsx
const cookieStore = await cookies();
const selectedSource =
  (await props.searchParams).source ?? cookieStore.get("nw.source")?.value ?? "zenn";
```

ソース変更時は Server Action か Route Handler で Cookie を書き、
`router.push(`/?source=${id}`)` で遷移。`useTransition` の pending をそのまま
フィルタ中インジケータに使える（現状の `isFiltering` Context が不要になる）。

### ツールバーの再構成

現状 `fetch-button.tsx` は「ソース選択カード」「取得ボタン」「結果表示」「更新中表示」を
1 コンポーネント 250 行に詰め込んでいる。分割する:

```
src/components/news/
├── source-filter.tsx    # ソース選択（URL 駆動）
├── fetch-action.tsx     # 取得実行 + 進捗
└── fetch-result.tsx     # 結果サマリ（折りたたみ）
```

レイアウト:

```tsx
<div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
  <SourceFilter value={selectedSource} /> {/* 左 */}
  <span className="text-sm text-muted-foreground">{count}件</span>
  <FetchAction source={selectedSource} className="ml-auto" /> {/* 右 */}
</div>
```

- カードで囲わない（`fetch-button.tsx:156` の `rounded-lg border bg-neutral-50` は過剰）
- ソース選択に `<Label>` を付ける（現状 `:158` は `<span>` でラベルになっていない）
- モバイルでは `SourceFilter` を `Sheet` に格納する選択肢も残す

## 4.4 更新中の体験

### 現状の問題（[01 §H](./01-current-state.md)）

- リスト全体が Skeleton に置換され、読んでいた記事が消える
- 解除経路が 3 系統（30 秒タイマー / 5 秒フォールバック / ID 差分）で競合

### 方針

**既存リストを消さない。** 更新中は:

1. リストに `aria-busy="true"` を付け、`opacity-60 pointer-events-none` で減光
2. ツールバー右にインライン進捗（`Loader2` の回転アイコン + テキスト）
3. 新着記事が入ったら、先頭に追加された分だけ `animate-in fade-in slide-in-from-top` で強調

これにより「スケルトンが詰まる」問題が体験上ほぼ無害になる（最悪でも減光が続くだけで、
記事は読める）。タイマーは 1 本の安全弁（30 秒）に減らせる。

初回ロードのみ Skeleton を使う（`loading.tsx` / `Suspense` fallback）。

### RefreshContext の縮小

`isFiltering` は `useTransition` で代替できるため削除。
`RefreshContext` は `isRefreshing` のみ残すか、`fetch-action.tsx` のローカル state に
落とし込めるなら Context 自体を削除する。

> `refresh-context.tsx` は Tier 5 のカバレッジ対象（`check-coverage-tiers.mjs:81`）。
> 削除する場合はパターンからも外す。

## 4.5 空状態

現状（`news-section.tsx:50-56`）は破線ボーダーの中にテキスト 2 行。
`Card` ベースの designed empty state にする:

- アイコン（`lucide-react` の `Newspaper` / `SearchX`）
- 見出し「まだ記事がありません」
- 説明（ソース名を含める:「Zenn の記事がまだ取得されていません」）
- **一次アクションのボタンを空状態の中に置く**（「ニュースを取得」）
  — 現状は上のツールバーまで視線を戻す必要がある

「フィルタ結果が 0 件」と「そもそもデータがない」を区別してメッセージを出し分ける。

## 4.6 レスポンシブ

| 幅         | レイアウト                                                |
| ---------- | --------------------------------------------------------- |
| `< sm`     | スコアを左上に小さく、タイトル全幅、メタは 2 行折り返し可 |
| `sm 〜 md` | 現行の横並び。スコア `h-11 w-11`                          |
| `>= md`    | スコア `h-12 w-12`、要約 2 行、メタ 1 行                  |

現状の `ml-4`（`article-list.tsx:222`）のような固定マージンは使わず、
親の `gap-3 sm:gap-4` に委ねる。

タップターゲットは最小 44×44px を守る（スコアトリガー、ナビ要素など）。
