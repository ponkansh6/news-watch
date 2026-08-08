# 01. 現状分析

実装を読んだ上での棚卸し。推測ではなく、該当行を確認した事実のみを挙げる。

## 1.1 UI ファイルの全体像

```
src/app/
├── layout.tsx              33行   RootLayout（Geist フォント + RefreshProvider）
├── globals.css             26行   Tailwind v4 の @theme と最小トークン
├── page.tsx                25行   `/` — RSC、記事取得
├── loading.tsx             32行   `/` の loading.tsx（page.tsx のシェルを手写しで複製）
├── article-list.tsx       267行   記事カード + ScoreBadge + トースト + Skeleton
├── news-section.tsx        62行   見出し + 空状態 + Skeleton 切替
├── fetch-button.tsx       250行   ソース選択 + 取得実行 + 結果表示
├── refresh-context.tsx     31行   isRefreshing / isFiltering の Context
├── bookmarks/
│   ├── page.tsx            76行   独自シェル（min-h-screen bg-neutral-50）
│   └── analyze-button.tsx  80行
└── admin/db/
    ├── layout.tsx          23行   さらに別のシェル（独自ヘッダー）
    ├── page.tsx            68行
    └── [table]/…           DataTable / RowDetail / Pagination
```

合計 ~1,040 行。**`src/components/` は存在せず**、ルートファイルと表示コンポーネントが
`src/app/` 直下に混在している。再利用可能な primitive は 1 つもない。

## 1.2 確認済みの欠陥

### A. フォント設定が二重に壊れている 🔴

`src/app/globals.css:11-12`:

```css
@theme inline {
  --font-sans: var(--font-geist-sans); /* ← 解決されない */
  --font-mono: var(--font-geist-mono);
}
```

Tailwind v4 の `@theme inline` は**パース時**に値を解決するため、Next.js が実行時に
className 経由で注入する `--font-geist-sans` は参照できない。この時点で `font-sans` は空。

さらに `src/app/globals.css:25`:

```css
body {
  font-family: Arial, Helvetica, sans-serif;
}
```

これが body 全体に効くため、**`layout.tsx` で読み込んだ Geist は一切使われていない**。
日本語は Arial にグリフがないため OS 依存のフォールバックで描画されており、
環境ごとに字面が変わる。

> なお `layout.tsx:27` でフォント変数を `<html>` に付けている点は正しい（`<body>` ではない）。

### B. ダークモードが実質破綻 🔴

`globals.css:15-20` で `prefers-color-scheme: dark` 時に `--background` / `--foreground` を
反転させているが、コンポーネント側は色を直書きしている:

- `article-list.tsx:173` — `border-neutral-200 bg-white`
- `article-list.tsx:181` — `text-neutral-900`
- `fetch-button.tsx:156` — `bg-neutral-50`、`:171` — `bg-white`
- `bookmarks/page.tsx:13` — `bg-neutral-50 text-neutral-900`
- `admin/db/layout.tsx:8-9` — `bg-neutral-50` / `bg-white`

結果として、OS がダークの利用者には**黒背景の上に白いカードと黒文字**が並ぶ。
`--background` / `--foreground` を参照しているのは `body` だけ。

### C. お気に入り登録が隠し操作 🔴

`article-list.tsx:91-110` + `:187-192`:

```tsx
<div className="select-none touch-manipulation"
     onPointerDown={() => { handleTap(article.id); }}>
```

要約テキスト領域を **4 秒以内に 5 回タップ**すると `/api/favorites/toggle` が呼ばれる。

- 視覚的アフォーダンスが皆無（`spec.md §9 Hidden Features` として意図的に隠されている）
- `onPointerDown` のみ → **キーボード操作が完全に不可能**
- 現在の登録状態が UI に一切出ない（トーストが消えると分からない）
- 記事本文を選択しようとして誤発火する

意図的な「隠し機能」であることは理解した上で、`/bookmarks` という表画面が既に存在する以上、
隠し続ける合理性は薄い。ただし **現状維持が決定** されたため、本プランでは変更しない。

> **決定（ユーザー確認済み）**: お気に入りは **現状維持**。5 回タップの隠しトグルを
> 明示 UI 化せず、この欠陥は既知の制約として許容する。`spec.md §9 Hidden Features` も
> 変更しない。以降のドキュメントではお気に入りの明示 UI 化に関する計画は扱わない。

### D. スコア内訳が `title` 属性だけ 🟡

`article-list.tsx:49`:

```tsx
title={`関連性: ${...} (20%)\n有用性: ${...} (50%)\n新しさ: ${...} (30%)\n…`}
```

- タッチデバイスで表示不可
- キーボードフォーカスで表示不可
- スクリーンリーダーの読み上げが不安定
- 同様に `:214` の `article.reason` も `title` 依存

スコアリングはこのアプリの中核価値なのに、その根拠が最も見えにくい形で提供されている。

### E. 画面間の導線が存在しない 🟡

- `/` には `/bookmarks` へのリンクが**ない**（URL 直打ちでしか到達できない）
- `/bookmarks` → `/` は `bookmarks/page.tsx:22-27` のテキストリンク `← Home`
- `/admin/db` → `/` は `admin/db/layout.tsx:11-13` の別実装 `← Home`

共通ヘッダーもナビゲーションも存在せず、シェルが 3 箇所で個別に書かれている。

### F. `loading.tsx` が page.tsx とずれている 🟡

`loading.tsx` は `page.tsx` のシェルを手で複製しているが、内容が同期していない:

| `page.tsx`                     | `loading.tsx`                         |
| ------------------------------ | ------------------------------------- |
| FetchButton → NewsSection の順 | NewsSection → 「データを読み込んで…」 |
| （該当セクションなし）         | `:27-29` 「最終更新: --」セクション   |

`loading.tsx:28` の「最終更新」は実画面に存在しない。ローディング → 実描画でレイアウトが
飛ぶ（CLS）。

### G. ソース選択の状態管理が二重化 🟡

`fetch-button.tsx`:

- `:24-31` 初期値を `localStorage` から読む
- `:35-37` 変更時に `localStorage` へ書く
- `:40-47` **マウント時に `router.replace()`** で URL を書き換える

一方 `page.tsx:6-7` はサーバー側で `searchParams.source ?? "zenn"` を読む。
つまり localStorage / URL / サーバーの 3 箇所に状態があり、初回描画では
「サーバーが `zenn` で描画 → マウント後に localStorage の値で再描画」という
ちらつきが構造的に発生する。

### H. 更新中の体験が破壊的 🟡

`news-section.tsx:48-49` — `isRefreshing` の間はリスト全体を `SkeletonList` に置換する。
既に読んでいた記事が消え、スクロール位置が失われる。

さらに、状態解除がタイマー頼み:

- `fetch-button.tsx:51-57` — 30 秒の強制解除タイマー
- `fetch-button.tsx:137-140` — 5 秒のフォールバックタイマー
- `news-section.tsx:20-29` — 記事 ID 差分による解除

3 系統の解除経路が競合しており、コメント自体が「stuck skeleton を防ぐため」と
書いている（＝現に詰まる経路がある）。

### I. その他

- **`error.tsx` / `not-found.tsx` が存在しない** — 例外時に Next.js の既定画面が出る
- **`<select>` にラベルがない** — `fetch-button.tsx:158` は `<span>` であって `<label>` ではない
- **Skeleton に `role="status"` / `aria-busy` がない** — 支援技術に読み込み中が伝わらない
- **キーワード色がハッシュ由来**（`article-list.tsx:56-74`）— コントラスト未検証の 8 色
- **スコアの色分けが色のみ**（`:39-44`）— 色覚特性への配慮なし
- **`transition-all duration-200`**（`:173`）— 全プロパティ遷移で不要な再描画
- **`prefers-reduced-motion` 未対応**
- **`public/` に Next.js テンプレートの残骸**（`next.svg` / `vercel.svg` / `window.svg` …）
- **メタデータが最小**（`layout.tsx:16-19`）— OGP、`theme-color`、アイコン未設定

## 1.3 制約として意識すべきもの

| 制約                        | 出典                                              | 影響                                                                 |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| Tier 5 UI カバレッジ >80%   | `spec.md §7.1` / `check-coverage-tiers.mjs:74-82` | 新規コンポーネントにテストが要る。ファイル移動時はパターン更新も必要 |
| pre-push でカバレッジ検証   | `AGENTS.md` / `.husky/`                           | 未達だと push がブロックされる                                       |
| `spec.md` 同期              | `scripts/check-spec-update.sh`                    | UI 構成変更時は `spec.md §6` の Component Tree 更新が必須            |
| パッケージマネージャは pnpm | `AGENTS.md`, `preinstall`                         | `npx` は使えない → `pnpm dlx`                                        |
| 既存コンポーネントテスト    | `tests/components/*.tsx`（6 ファイル）            | DOM 構造依存の箇所がある → [07-roadmap.md](./07-roadmap.md)          |
