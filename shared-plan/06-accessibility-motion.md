# 06. アクセシビリティ・モーション・パフォーマンス

## 6.1 現状のアクセシビリティ欠陥

| #   | 箇所                        | 問題                                                                                     | 深刻度 |
| --- | --------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| A1  | `article-list.tsx:187-192`  | お気に入りが `onPointerDown` のみ → **キーボードで到達不能**（現状維持のため対応しない） | 🟡     |
| A2  | `article-list.tsx:49`       | スコア内訳が `title` 属性 → タッチ/キーボード/SR で不安定                                | 🔴     |
| A3  | `fetch-button.tsx:158,168`  | `<select>` に `<label>` がない（`<span>` はラベルでない）                                | 🟡     |
| A4  | `article-list.tsx:237-267`  | Skeleton に `role="status"` / `aria-busy` がない                                         | 🟡     |
| A5  | `article-list.tsx:39-44`    | スコアの区別が色のみ                                                                     | 🟡     |
| A6  | `article-list.tsx:56-74`    | キーワード 8 色のコントラスト未検証                                                      | 🟡     |
| A7  | `article-list.tsx:214`      | `reason` が `title` のみ + `text-neutral-400`（低コントラスト）                          | 🟡     |
| A8  | `news-section.tsx:31,39-44` | 「更新中」「フィルタリング中」が `aria-live` 領域外                                      | 🟡     |
| A9  | 全般                        | フォーカスリングがブラウザ既定任せ。`focus-visible` 未整備                               | 🟡     |
| A10 | `article-list.tsx:169-232`  | 記事間をスキップする手段がない（見出し構造なし）                                         | 🟢     |

## 6.2 対応方針

### キーボード操作

すべてのインタラクティブ要素をネイティブ `<button>` / `<a>` / Radix primitive にする。
`<div onPointerDown>` は使わない。

記事カード内のタブ順序を固定する:

```
タイトルリンク → スコア（Popover トリガー）→ 次のカード
```

キーボードショートカット（任意、Phase 5）:

| キー      | 動作                         |
| --------- | ---------------------------- |
| `j` / `k` | 次/前の記事へフォーカス      |
| `o`       | フォーカス中の記事を開く     |
| `?`       | ショートカット一覧（Dialog） |

入力要素にフォーカスがある間は無効化すること。

### フォーカス可視化

shadcn の既定に従う（`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`）。
`globals.css` の `@layer base` に `outline-ring/50` を入れることで全要素に基準線が入る
（[02 §2.2](./02-design-system.md)）。

**フォーカスリングをどこでも `outline-none` で消さない。**

### ライブリージョン

| 内容                     | 実装                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| トースト                 | お気に入りトーストは現状維持（`role="alert"` のまま）。sonner 導入時は `aria-live` 込みで提供 |
| 「更新中」「フィルタ中」 | `<span role="status" aria-live="polite">` で包む                                              |
| 記事リストの読み込み中   | リスト側に `aria-busy={isRefreshing}`                                                         |
| 件数の変化               | `role="status"` の要素に「N 件」を出す（読み上げ過多に注意し `aria-live="polite"`）           |

Skeleton には:

```tsx
<div role="status" aria-label="記事を読み込み中" aria-busy="true">
  …<span className="sr-only">読み込み中</span>
</div>
```

### コントラスト

WCAG AA（本文 4.5:1 / 大きい文字 3:1）を**ライト・ダーク両方で**満たす。
特に検証が必要な箇所:

- `text-neutral-400`（`article-list.tsx:190,214`, `news-section.tsx:38,51`）
  → `text-muted-foreground` に置換。現状の `neutral-400` は白背景で **2.8:1 で AA 不合格**
- スコアの 3 tier 色（新トークン `--score-*`）
- キーワードバッジ（→ 単色 `Badge variant="secondary"` に統一して問題を消す）
- `admin/db` のテーブル縞模様

検証方法: Chrome DevTools の Lighthouse + axe DevTools 拡張。
ダークモードは `.dark` を手動付与して再測定する。

### セマンティクス

- 記事カードは `<article>`（現状も `article-list.tsx:171` で正しい）
- カード内タイトルを `<h3>` にし、`NewsSection` の `<h2>`（`news-section.tsx:36`）と
  階層をつなぐ → スクリーンリーダーの見出しジャンプが機能する
- リストは `<ul role="list">` / `<li>` に。現状は `<div className="space-y-3">`
- `<time dateTime>` は既に正しい（`:203`）

### 言語属性

`<html lang="ja">` は正しい（`layout.tsx:27`）。
英語混じりの UI テキスト（`/admin/db` の説明文など）には `lang="en"` を付けるか、
日本語に統一する（[05 §5.2](./05-bookmarks-admin.md)）。

## 6.3 モーション

### 原則

- 遷移は `transition-colors` / `transition-opacity` に限定する。
  `transition-all`（`article-list.tsx:173`）は使わない — 意図しないプロパティまで
  アニメーションし、コンポジット外の再描画を招く
- duration は 150ms（マイクロ）/ 200ms（パネル）の 2 種のみ
- `tw-animate-css`（shadcn v4 の既定）の `animate-in` / `fade-in` / `slide-in-from-*` を使う

### `prefers-reduced-motion`

`globals.css` に全体ガードを入れる:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Skeleton の `animate-pulse` も止まるが、`role="status"` があるため情報は失われない。

### テーマ切替

`next-themes` の `disableTransitionOnChange` を有効にする（[02 §2.4](./02-design-system.md)）。
これがないと切替時に全要素が色遷移してちらつく。

## 6.4 パフォーマンス

### フォント

- Noto Sans JP は日本語グリフが重い。`display: "swap"` + weight 3 種に制限
- Geist / Geist Mono / Noto Sans JP の 3 ファミリで打ち止め。それ以上増やさない
- 導入後に `pnpm build` の First Load JS と、Lighthouse の
  「Ensure text remains visible during webfont load」を確認する

### バンドル

shadcn は必要な primitive だけコピーされるため肥大しにくいが:

- `lucide-react` は**名前付き import のみ**（`import { Heart } from "lucide-react"`）。
  `next.config.ts` の `optimizePackageImports` に追加する:

  ```ts
  experimental: {
    optimizePackageImports: ["@google/generative-ai", "lucide-react"],
  }
  ```

- Client Component 境界を最小化する。現状 `news-section.tsx` と `article-list.tsx` が
  丸ごと `"use client"` だが、カードの静的部分は RSC に残せる。
  `score-popover.tsx` だけをクライアントにする

  > `@sbougerel/eslint-plugin-next-use-client-boundary` が devDependencies に入っており、
  > 境界の検証は既に自動化されている

### レンダリング

- `getScoredArticlesCached(100, source)` は最大 100 件を一度に描画する。
  実測して問題があれば「50 件 + もっと見る」に切る。仮想化は現時点では過剰
- 記事カードは `key={article.id}`（現状正しい）
- `SkeletonList` の `key={i}`（`article-list.tsx:263`）は静的リストなので許容

### 計測の基準

| 指標            | 目標    | 計測                        |
| --------------- | ------- | --------------------------- |
| LCP             | < 2.5s  | Lighthouse（モバイル、4G）  |
| CLS             | < 0.1   | 特に loading → 実描画の遷移 |
| INP             | < 200ms | ソース切替                  |
| Lighthouse a11y | 100     | ライト/ダーク両方           |

刷新の前後で必ず両方測り、[07-roadmap.md](./07-roadmap.md) の完了条件に含める。
