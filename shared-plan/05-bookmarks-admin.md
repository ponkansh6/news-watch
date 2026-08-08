# 05. `/bookmarks` と `/admin/db`

## 5.1 `/bookmarks`

### 現状

`src/app/bookmarks/page.tsx`（76 行）:

- `:13` 独自シェル `div.min-h-screen.bg-neutral-50.text-neutral-900` → ダークで破綻
- `:16` `text-2xl font-bold tracking-tight` — `/` の `text-3xl`（`page.tsx:13`）と不揃い
- `:22-27` テキストリンク `← Home` — 共通ナビがないための代替
- `:31-63` 嗜好プロファイルカードが手書き。情報が縦に詰まっている
- `:45` テーマチップが `bg-blue-50 text-blue-600` 直書き
- `:52-62` 「分析時 N 件 → 現在 M 件」の差分表示が小さく、再分析の促しが弱い
- `analyze-button.tsx:55` — 右寄せ縦積みで、メッセージがボタン下に生えてレイアウトが動く

### 再設計

#### シェル

`PageShell`（[03 §3.3](./03-app-shell.md)）を使う。独自の `min-h-screen` ラッパーと
`← Home` は削除（共通ヘッダーが担う）。

```tsx
<PageShell title="ブックマーク"
           description={`${articles.length} 件のお気に入り`}
           actions={<AnalyzeButton … />}>
```

#### 嗜好プロファイルカード

`Card` + `CardHeader` / `CardContent` / `CardFooter` で構造化する。

```
┌─────────────────────────────────────────────────────────┐
│ 嗜好プロファイル                    2026/08/08 12:34 [再分析]│  ← CardHeader
├─────────────────────────────────────────────────────────┤
│ （summary 本文）                                          │
│                                                          │
│ [React] [TypeScript] [パフォーマンス] [設計]              │  ← Badge secondary
├─────────────────────────────────────────────────────────┤
│ 分析時 12 件 → 現在 18 件  ⚠ 再分析を推奨   gemini-2.x  │  ← CardFooter, muted
└─────────────────────────────────────────────────────────┘
```

- 件数差分の警告（`page.tsx:55-59`）は `Alert variant="default"` に格上げし、
  **再分析ボタンをその中に置く**。現在は文言だけで、行動への導線がない
- テーマチップは `Badge variant="secondary"` に統一（`:45` の直書き色を廃止）
- `model` 名は `font-mono text-xs text-muted-foreground`

#### AnalyzeButton

- `Button variant="outline"` に置換（`analyze-button.tsx:60` の直書きを廃止）
- ローディング中は `Loader2` の回転アイコン + テキスト
  — 「最大45秒」という長時間処理なので、**開始時刻からの経過秒を出す**と体感が改善する
- 結果メッセージ（`:70-77`）は sonner のトーストへ移す
  → ボタン下のレイアウト移動がなくなる
- 無効理由（`:65-69`「お気に入りが5件以上で…」）は `Tooltip` に移し、
  ボタン自体は `disabled` のまま。ツールチップは `disabled` 要素に付かないため
  ラッパー `<span tabIndex={0}>` で包む

> ⚠️ **既存テスト影響**: `tests/components/AnalyzeButton.test.tsx` は
> `getByRole("button", { name: "傾向を分析" })`、`getByText(/お気に入りが5件以上で…/)`、
> `getByText("嗜好プロファイルを更新しました")` に依存している。
> トースト化と Tooltip 化で 3 箇所とも要修正。[07-roadmap.md](./07-roadmap.md) 参照。

#### 記事リスト

`/` と同じ `ArticleList` を共用する（現状も `bookmarks/page.tsx:71` で共用）。
お気に入りは現状維持のため、ブックマーク画面でも 5 回タップの隠しトグルがそのまま
機能する（登録済み記事へのタップで解除）。

- 空状態のメッセージを日本語に統一する（`page.tsx:66-69` の英語 "No bookmarked articles yet."
  は他が日本語なので統一する）

## 5.2 `/admin/db`

内部向けツールなので投資は最小に留めるが、**共通トークンへの追従は必須**
（ダークモードで壊れるため）。

### `admin/db/layout.tsx`

独自ヘッダー（`:9-19`）を削除し、共通 `AppHeader` に統合する。
パンくずが必要なら shadcn の `breadcrumb` を追加:

```
News Watch / DB / articles
```

`:11,15` の生 `<a>` は `next/link` の `Link` に置換（クライアント遷移が効いていない）。

`metadata`（`:1-4`）の `robots: "noindex"` は維持する。

### `admin/db/page.tsx`

現状のテーブル一覧カード（`:37-65`）は構造としては妥当。以下を適用:

| 変更                                                                                                      |
| --------------------------------------------------------------------------------------------------------- |
| `bg-white border-neutral-200` → shadcn `Card`                                                             |
| `bg-neutral-100 text-neutral-700` のテーブル名 → `Badge variant="outline"` + `font-mono`                  |
| 行数 → `font-mono tabular-nums`                                                                           |
| `grid-cols-1 md:grid-cols-2` → `sm:grid-cols-2 xl:grid-cols-4`（4 テーブルなので 1 行に収まる）           |
| `shadow-xs hover:shadow-sm` → `hover:border-ring transition-colors`（影より境界線の方がダークで機能する） |

`TABLE_DESCRIPTIONS`（`:6-23`）の説明文は英語。admin なので許容だが、
日本語に揃えるなら一括で。

### `admin/db/[table]/components/`

`DataTable.tsx` / `RowDetail.tsx` / `Pagination.tsx` は Tier 5 のカバレッジ対象
（`spec.md §7.1`）。**構造は変えず、色クラスのトークン置換に留める**のが安全。

| 対象         | 適用                                                            |
| ------------ | --------------------------------------------------------------- |
| `DataTable`  | shadcn `Table` primitive へ置換。`ScrollArea` で横スクロール    |
| セル         | 長い値は `max-w-[24ch] truncate` + `Tooltip` で全文             |
| `RowDetail`  | `Sheet`（右からスライド）へ。現在のインライン展開より読みやすい |
| `Pagination` | shadcn `pagination` primitive へ置換                            |
| 数値/ID/日時 | `font-mono tabular-nums`                                        |

`RowDetail` の `Sheet` 化は DOM 構造が変わるため、既存テストがあれば影響する。
**Phase 5（最終フェーズ）に回す**。

## 5.3 優先度

| 対象                               | 優先度 | 理由                                     |
| ---------------------------------- | ------ | ---------------------------------------- |
| `/bookmarks` シェル統一 + トークン | 高     | ダークモードで壊れる。ユーザー可視画面   |
| 嗜好プロファイルカード再構成       | 中     | 情報は出ているが行動導線が弱い           |
| `/admin/db` トークン置換           | 中     | ダークで壊れるが内部向け                 |
| `DataTable` / `RowDetail` 刷新     | 低     | 機能的には足りている。テスト影響が大きい |
