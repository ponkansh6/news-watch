# 08. 実装検証レポート

> 検証日: 2026-08-08
> 対象: `docs/implementation-notes.md` の記述と `shared-plan/01`〜`07` の計画に対する実装実体
> 検証者: Claude（コード実読 + テスト/型/リント/ビルドの実行）

## 0. 総括

| 判定 | 内容                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅   | **Phase 0（基盤据え付け）は完了している。** shadcn/ui、トークン、フォント、next-themes、設定ファイル追随（vitest / next.config / coverage tiers）はすべて計画どおり |
| ⚠️   | **Phase 1 は「シェル」だけ完了し、「トークン移行」が大幅に未達。** 計画の中心的な目的である**ダークモードの成立が達成できていない**                                 |
| ⚠️   | **Phase 2 は ScorePopover のみ完了。カード自体の再設計（`Card` 化 / `<ul>/<li>` / スコア左配置 / `reason` の Tooltip 化）は未着手**                                 |
| ✅   | **`implementation-notes.md` の数値主張はすべて再現できた**（326 passed / 2 skipped / 63 files、Tier 5 92.09%、tsgo クリーン、oxlint 警告のみ）                      |
| 🔴   | **ただし `implementation-notes.md` の「spec.md 参照検証: 有効」は誤解を招く。** スクリプトは PASS するが spec.md には実在しないパスが残っている（§4.2 参照）        |

**一言でいうと**: 「土台は正しく敷けたが、その土台の上に画面を載せ替える作業（Phase 1-5 と Phase 2-3）が途中で止まっており、
README が挙げた 4 つの問題意識のうち **#2「ダークモードが実質破綻している」は未解決のまま**」。

---

## 1. 検証方法

実行したコマンドと結果（すべて再現済み）:

| コマンド                                          | 結果                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm exec vitest run --coverage`                 | **63 passed / 2 skipped（65 files）、326 passed / 2 skipped（328 tests）** ✅    |
| `node scripts/check-coverage-tiers.mjs`           | 全ティア PASS（Tier 1: 100% / Tier 5: **92.09%** / Tier 4: ⚠️ No files matched） |
| `pnpm exec tsgo --noEmit`                         | EXIT=0、エラーなし ✅                                                            |
| `pnpm run lint:fast`                              | エラー 0、警告のみ（すべて `tests/` 配下の既存 unused-vars 等） ✅               |
| `pnpm run build`                                  | ✓ Compiled successfully（8.0s）、9 ページ生成 ✅                                 |
| `bash scripts/check-spec-refs.sh`                 | ✅ PASS（ただし偽陽性 → §4.2）                                                   |
| ビルド後 CSS の `font-family` / `@font-face` 実測 | Geist / Geist Mono / Noto Sans JP がすべて実配信されている ✅                    |

加えて、`src/**/*.tsx`（`src/components/ui/**` を除く）の直書き色クラスを機械的に集計した。

---

## 2. フェーズ別の達成状況

### Phase 0 — 基盤の据え付け ✅ 完了

| #   | 計画                                                       | 実体                                                                                            | 判定 |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---- |
| 1   | shadcn init → `components.json` / `src/lib/utils.ts`       | 両方存在。alias も計画どおり                                                                    | ✅   |
| 2   | `globals.css` を §2.2 の形に（フォントのリテラル名化）     | `@theme inline` に `"Geist", "Geist Fallback", …` のリテラル名。循環参照なし                    | ✅   |
| 3   | `body { font-family: Arial… }` 削除                        | 削除済み。代わりに `html { @apply font-sans }`                                                  | ✅   |
| 4   | `@media (prefers-color-scheme: dark)` → `.dark` クラス方式 | `@custom-variant dark` + `.dark {}` ブロック                                                    | ✅   |
| 5   | Noto Sans JP 追加                                          | `layout.tsx:20-25`、weight 3 種 + `display: "swap"`                                             | ✅   |
| 6   | `next-themes` + `ThemeProvider`                            | `layout.tsx:54-59`、`attribute="class"` / `defaultTheme="system"` / `disableTransitionOnChange` | ✅   |
| 7   | primitive 一括追加（16 個）                                | `src/components/ui/` に 16 ファイル、計画リストと完全一致                                       | ✅   |
| 8   | カバレッジ除外 `src/components/ui/**`                      | `vitest.config.ts:23`                                                                           | ✅   |
| 9   | `lucide-react` を `optimizePackageImports` へ              | `next.config.ts:7`                                                                              | ✅   |

**実測による裏付け（§2.2 / §6.4 の懸念点）**:

- ビルド出力 CSS に `@font-face{font-family:Geist}` / `Geist Fallback` / `Noto Sans JP` / `Noto Sans JP Fallback` が生成されており、
  **Next.js 16 はハッシュなしのリテラル名で `@font-face` を出す**ため、計画のリテラル名方式は正しく機能している。
  `01 §A` が指摘したフォント破綻は解消済み。
- `subsets: ["latin"]` 指定だが、生成された `@font-face` には CJK の `unicode-range`（U+2000B〜U+2F9F4 など）が含まれており、
  **日本語グリフは配信される**（preload されないだけ）。パフォーマンス上むしろ望ましい挙動。

**軽微な差分**: `components.json` の `style` が `"radix-nova"`（計画は `new-york` 想定）。
機能影響はないが、計画との差分として記録しておく。

---

### Phase 1 — アプリシェルとトークン移行 ⚠️ 未完了

| #   | 計画                                                    | 実体                                                                                                                  | 判定 |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | `AppHeader` / `AppNav` / `ThemeToggle`                  | 3 ファイルとも存在。`aria-current` / モバイル Sheet / 3 択テーマ切替すべて実装済み                                    | ✅   |
| 2   | `PageShell`                                             | `src/components/layout/page-shell.tsx`                                                                                | ✅   |
| 3   | 3 画面を `PageShell` に載せ替え                         | `/`・`/bookmarks`・`/admin/db` は載った。**`/admin/db/[table]` は未対応**（`<h1>` なし）                              | ⚠️   |
| 4   | 独自シェルを削除                                        | `bookmarks` の `min-h-screen` ✅、`admin/db/layout.tsx` の独自ヘッダー ✅。**ただし `<main>` が残存 → §3.1 の不具合** | ⚠️   |
| 5   | **全ファイルの色クラスをトークンへ一括置換**            | **未達。8 ファイル・133 箇所が直書きのまま** → §3.2                                                                   | 🔴   |
| 6   | `sonner` の `<Toaster />` 配置                          | `layout.tsx:63`。手書きトーストは計画（03 §3.4）どおり維持                                                            | ✅   |
| 7   | `error.tsx` / `not-found.tsx` / `bookmarks/loading.tsx` | 3 つとも作成済み。**`src/app/admin/db/error.tsx` のみ未作成**（03 §3.4 の表に記載あり）                               | ⚠️   |
| 8   | `loading.tsx` を `PageShell` ベースで作り直す           | 「最終更新」の幻セクションは消え、`PageShell` + `Skeleton` に                                                         | ✅   |
| 9   | メタデータ拡充 / `public/` の残骸削除                   | metadata は拡充済みだが **`icons` 未設定**。**`public/` の 5 ファイルが残存**                                         | ⚠️   |

#### Phase 1 完了条件「ライト/ダーク両方で全画面が破綻しない」 → ❌ 未達成

---

### Phase 2 — 記事体験の再設計 ⚠️ 部分完了

| #   | 計画                                                       | 実体                                                                               | 判定 |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---- |
| 1   | `src/lib/ui/score.ts`（純関数）+ 単体テスト                | 実装・テスト（境界値 6 ケース）とも計画どおり                                      | ✅   |
| 2   | `ScoreBadge` → `ScorePopover` + `ScoreBreakdown`           | `score-popover.tsx` に両方。横バー + 重み表記も実装                                | ✅   |
| 3   | **`ArticleCard` を `Card` ベースで再構成、`<ul>/<li>` 化** | **未着手**。手書き `<article>` + 直書き色。`Card` 未使用、リスト化なし             | 🔴   |
| 4   | キーワードチップを `Badge variant="secondary"` に統一      | 8 色ハッシュは廃止され `Badge variant="secondary"` に                              | ✅   |
| 5   | ファイル移動 + §7.4 の追随作業                             | 移動 ✅ / `check-coverage-tiers.mjs` ✅ / `vitest.config.ts` ✅ / **`spec.md` ❌** | ⚠️   |

#### Phase 2 完了条件「キーボードのみで記事を開く / スコア内訳を見る」 → ✅ 達成

`ScorePopover` のトリガーはネイティブ `<button>`、記事リンクは `<a>` なので、この条件自体は満たしている。

#### ただし 04 §4.2 の「新しいカード構造」で未実装の項目

| 計画項目（04 §4.2）                                                            | 実体                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| スコアの位置を **右 → 左** に移す（視線の起点に価値指標）                      | `article-card.tsx:94` で右のまま（`ml-4` の固定マージンも 04 §4.6 で「使わない」とされたもの）  |
| tier ごとに**左端の縦バー太さ/塗り面積**を変える（色覚に依存しない冗長符号化） | 未実装。色 + 数値のみ                                                                           |
| トリガーの `aria-label` に tier ラベルを含める                                 | トリガーは `スコア 8 の内訳を表示`。tier ラベルは `ScoreBreakdown` 側の `aria-label` にのみ存在 |
| `reason` を Tooltip 付きの `ⓘ` に格納                                          | 未実装。`title` 属性のまま（**06 §6.1 A7 が未解決**）                                           |
| メタ情報を `Separator` 区切りの 1 行に                                         | 未実装                                                                                          |
| `transition-all` → `transition-colors`                                         | `article-card.tsx:57` に `transition-all duration-200` が残存（06 §6.3 の明示的な禁止事項）     |
| カード内タイトルを `<h3>` に（06 §6.2 セマンティクス）                         | `<a>` 直置き。見出し階層が `<h2>` で途切れる                                                    |

---

### Phase 3 / 4 / 5 — 未着手（計画どおりの想定範囲）

Phase 3（ツールバー・更新体験）、Phase 4（`/bookmarks`）、Phase 5（`/admin/db`）は未着手。
`fetch-button.tsx` は `src/app/` に 250 行のまま残っており、localStorage / URL 二重管理も
マウント時 `router.replace()` も健在（`fetch-button.tsx:24-47`）。これは計画上「まだやらない」範囲なので**問題ではない**。

ただし **Phase 1 #5（トークン移行）は全ファイルが対象**だったため、
`fetch-button.tsx` の色だけは Phase 3 を待たずに置換されているべきだった（→ §3.2）。

---

## 3. 具体的な不具合・不足（優先度順）

### 3.1 🔴 `/admin/db` で `<main>` が二重にネストしている

- `src/app/admin/db/layout.tsx:8` が `<main className="mx-auto w-full max-w-7xl …">` を描画
- `src/app/admin/db/page.tsx:30` が `PageShell`（= `<main>`、`page-shell.tsx:22`）を描画

結果として `<main>` の中に `<main>` が入る。HTML 仕様違反であり、
スクリーンリーダーのランドマークナビゲーションが壊れる。**Lighthouse Accessibility = 100 は達成できない**（07 §7.6 の完了条件）。

また `admin/db/layout.tsx` は `max-w-7xl` を持ち、`PageShell width="wide"` も `max-w-7xl` を持つため、
パディングが二重に適用されている。

### 3.2 🔴 トークン移行が未完了 — ダークモードが依然として破綻している

`src/**/*.tsx`（`components/ui/**` 除く）の直書き色クラス集計:

| ファイル                                             | 直書き箇所 | 該当 Phase                         |
| ---------------------------------------------------- | ---------- | ---------------------------------- |
| `src/app/admin/db/[table]/components/DataTable.tsx`  | 37         | Phase 1 #5（構造は Phase 5）       |
| `src/app/fetch-button.tsx`                           | 26         | Phase 1 #5（分割は Phase 3）       |
| `src/app/admin/db/[table]/components/RowDetail.tsx`  | 24         | Phase 1 #5                         |
| `src/app/admin/db/[table]/components/Pagination.tsx` | 15         | Phase 1 #5                         |
| **`src/components/article/article-list.tsx`**        | 10         | Phase 1 #5                         |
| **`src/components/article/article-card.tsx`**        | 9          | **Phase 1 #5 + Phase 2 #3**        |
| `src/app/bookmarks/analyze-button.tsx`               | 7          | Phase 1 #5（トースト化は Phase 4） |
| **`src/components/news/news-section.tsx`**           | 5          | Phase 1 #5                         |
| **合計**                                             | **133**    |                                    |

特に深刻なのは **`article-card.tsx:57` の `border-neutral-200 bg-white`** と **`:64` の `text-neutral-900`**。
これは `01 §B` が「OS がダークの利用者には黒背景の上に白いカードと黒文字が並ぶ」と名指しした箇所そのもので、
ファイルが `src/app/` から `src/components/article/` へ移動しただけで**中身は変わっていない**。

`README.md` の「中心にある問題意識」#2（ダークモードが実質破綻している）は未解決。

副次的に、以下の a11y 項目も未解決のまま:

- `06 §6.1 A7` — `article-card.tsx:86` の `text-neutral-400` は白背景で 2.8:1、**WCAG AA 不合格**
- `06 §6.1 A8` — `news-section.tsx:39-45` の「更新中」「フィルタリング中」に `role="status"` / `aria-live` がない
- `06 §6.2` — 記事リストが `<div className="space-y-3">`（`article-list.tsx:79`）のまま。`<ul>/<li>` 化されていない

### 3.3 🟡 `spec.md` が実装と乖離している（07 §7.4-2 の未実施）

`openspec/specs/news-watch/spec.md` の以下が未更新:

| 箇所                         | 内容                                                           | 状態                                   |
| ---------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| `:199-201` §6 Component Tree | `src/app/news-section.tsx` / `src/app/article-list.tsx` を参照 | **両ファイルとも削除済み。実在しない** |
| `:223-224` データフロー図    | 同上 + 「tooltip breakdown」の記述                             | Popover 化されたのに tooltip のまま    |
| `:281` §7.1 Tier 5           | 対象を `article-list.tsx`, `news-section.tsx`, … と記載        | パスが旧構成。`layout/**` も未追加     |
| `:252-261` Technology Stack  | shadcn/ui, Radix, next-themes, lucide-react の記載なし         | grep で 0 件ヒット                     |
| §3.2 Article Display         | スコア内訳の提示方法（Popover）が未反映                        | 未更新                                 |

### 3.4 🟡 `check-spec-refs.sh` が腐敗を検出できていない（偽陽性の PASS）

`docs/implementation-notes.md:178` は「spec.md 参照検証: 有効」と記載しているが、これは**検証が機能していないことを見落としている**。

原因は `scripts/check-spec-refs.sh:27`:

```bash
REFS=$(grep -oP '`((src|tests)/[^`]+)' "$SPEC_FILE" …)
```

**バッククォートで囲まれたパスしか拾わない。**
spec.md の Component Tree（`:195-208`）は ```フェンス内のプレーンテキストで、個々のパスにバッククォートが付いていない。
そのため`src/app/article-list.tsx`（実在しない）が**検査対象から漏れて素通りする**。

これは 07 §7.4 が `aggregateCoverage()` について警告した「更新漏れに気づけない」構造と同種の罠が、
別のスクリプトにも存在していたということ。

### 3.5 🟡 `admin/db/error.tsx` が未作成

03 §3.4 の表に「DB 接続失敗を admin 内に閉じ込める」として明記されているが未作成。
現状 `/admin/db` の DB 例外は `src/app/error.tsx`（ルート境界）まで浮上する。

### 3.6 🟡 `public/` の Next.js テンプレート残骸が未削除

03 §3.5 / Phase 1 #9 の対象。以下が残存:

```
public/file.svg  public/globe.svg  public/next.svg  public/vercel.svg  public/window.svg
```

（`public/favicon.svg` は正当なファイル。ただし `layout.tsx` の metadata に
`icons: { icon: "/favicon.svg" }` が**設定されていない**ため、参照されていない。）

### 3.7 🟡 ヘッダーのブックマーク件数バッジが未実装

03 §3.2 の「ナビゲーション項目」表で「ブックマーク … 件数バッジを付ける」、
かつ「`<Suspense fallback={null}><BookmarkCountBadge /></Suspense>` でサーバーコンポーネントに閉じる」と
設計されていたが未実装。

なお `app-header.tsx:1` が `"use client"` になっているため、この設計を後から入れるには
`AppHeader` から `"use client"` を外し、`children` 経由で RSC を差し込む形に組み替える必要がある
（現状 `AppHeader` 自体に client を要する処理はなく、`AppNav` / `ThemeToggle` が個別に `"use client"` を持っている）。

### 3.8 🟢 `/bookmarks` の空状態が英語のまま

05 §5.1 で「空状態のメッセージを日本語に統一する」と明記。
`src/app/bookmarks/page.tsx:60` は `No bookmarked articles yet.` のまま。
Phase 4 の範囲だが、1 行で直せる。

### 3.9 🟢 `ArticleCardProps.keyword` がデッドプロップ

`article-card.tsx:20` で `keyword?: string | null` を宣言しているが destructure されず未使用
（表示は `keywordLabel` を使用）。`ArticleList` が `{...article}` でスプレッドするため型的には無害だが、
実装ノート §3.3 の props 表にも記載がなく、意図が読み取れない。

### 3.10 🟢 `ThemeToggle` のテストが 3 状態を網羅していない

07 §7.5 は「3 状態の切替」を要求。実際のテストは `dark` のみ（`ThemeToggle.test.tsx:26`）。
カバレッジにも表れている（`theme-toggle.tsx` 66.66%、未カバー行 28・36 = light / system）。

### 3.11 ℹ️ `check-coverage-tiers.mjs` の Tier 4 が「No files matched」

```
Tier 4: Data Access    ⚠️  No files matched
```

パターンが `/\/db\/actions\.ts$/` のままだが、`actions.ts` は R3-a で削除済み
（spec.md `:279` も「actions.ts removed in R3-a」と記載）。
**今回の作業とは無関係の既存問題**だが、07 §7.4 が警告した「パターンが 1 つも当たらないと素通りする」状態が
現に発生しているので、併せて記録しておく。

---

## 4. `docs/implementation-notes.md` の記述精度

### 4.1 再現できた主張 ✅

| 主張                                                   | 検証結果                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| 全テスト 326 passed / 2 skipped（63 ファイル）         | **完全一致**                                                 |
| 型チェック `tsgo --noEmit` エラーなし                  | EXIT=0                                                       |
| リント oxlint エラーなし（警告のみ・既存）             | エラー 0、警告はすべて `tests/` 配下                         |
| カバレッジ Tier 1: 100% / Tier 5: 92.09%               | **完全一致**                                                 |
| ファイル構成・旧配置の削除                             | `src/app/article-list.tsx` / `news-section.tsx` とも削除確認 |
| お気に入り機能（5 回タップ・4 秒・トースト）が現状維持 | `article-list.tsx:26-45` で挙動一致。計画の決定事項どおり    |
| リフレッシュ解除の 3 経路（ID 差分 / 5 秒 / 30 秒）    | 実装と一致                                                   |

**お気に入り機能の復旧は正しく行われている。** §7 の経緯メモにある fix-4 の破壊（`novelty` / `breakdown` /
`keywords` 等の誤フィールド、傾向分析モード切替）は現在のコードに痕跡がなく、
`FavoriteArticleList.test.tsx` も通っている。

### 4.2 訂正が必要な記述 ⚠️

| 記述（行）                                     | 問題                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:178` 「spec.md 参照検証: 有効」              | スクリプトは PASS するが、**spec.md には実在しないパスが 2 件残っている**（§3.4）。「スクリプトが通った」と「spec.md が正しい」は別。                                                     |
| `:171` 「検証結果（2026-08-08 時点）」の見出し | 列挙されている検証項目に **ダークモード目視・Lighthouse・キーボード走査が含まれていない**。07 §7.6 の完了条件のうち自動検証できる項目だけが並んでいるため、「Phase 2 完了」と読めてしまう |
| `:76-96` §3.3 の props 表                      | `keyword` prop（§3.9）が表にない。また「ルートは `<article>` 要素」とあるが、計画（Phase 2 #3 / 06 §6.2）が求めた `<ul>/<li>` 化には触れていない                                          |

### 4.3 記述されていない重要事項

- `article-card.tsx` が**直書き色のままである**こと（Phase 1 #5 の宿題が残っていること）が
  実装ノートのどこにも書かれていない。「Phase 2 の再編は完了した」と読めるが、
  カード再設計（Phase 2 #3）は実質未着手
- `spec.md` 未更新が 07 §7.4 の必須追随作業であること

---

## 5. 完了条件（07 §7.6）に対する現在地

| 項目                                         | 判定 | 根拠                                                               |
| -------------------------------------------- | ---- | ------------------------------------------------------------------ |
| ライト/ダーク両方で全 4 画面が破綻しない     | ❌   | §3.2（133 箇所の直書き色）                                         |
| Lighthouse Accessibility = 100               | ❌   | §3.1（`<main>` ネスト）、§3.2（A7/A8 未解決）                      |
| キーボードのみで全機能に到達可能             | ⚠️   | スコア内訳 ✅ / お気に入りは計画上の既知の制約として許容           |
| CLS < 0.1                                    | ⏸️   | 未計測                                                             |
| `vitest run --coverage` 全通過 + Tier 全達成 | ✅   | 326 passed、全ティア PASS（Tier 4 の No files matched は既存問題） |
| `lint:fast` / `tsgo --noEmit` クリーン       | ✅   | 実行確認済み                                                       |
| `spec.md` の `src/` 参照が全て実在           | ❌   | §3.3 / §3.4（スクリプトの偽陽性 PASS）                             |
| Geist + Noto Sans JP が実際に適用されている  | ✅   | ビルド出力 CSS の `@font-face` を実測                              |
| First Load JS が刷新前 +30KB 以内            | ⏸️   | Next.js 16 のビルド出力にサイズ表が出ないため未計測                |

**9 項目中: ✅ 3 / ⚠️ 1 / ❌ 3 / ⏸️ 2**

---

## 6. 次にやるべきこと

→ [09-remediation-plan.md](./09-remediation-plan.md)
