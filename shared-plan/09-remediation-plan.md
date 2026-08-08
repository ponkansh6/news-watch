# 09. 不足点の是正プラン

> 作成日: 2026-08-08
> 前提: [08-verification-report.md](./08-verification-report.md) の検証結果
> 位置づけ: Phase 3 以降に進む**前に**片付けるべき「Phase 1 / 2 の積み残し」

## 進行状況（2026-08-08 追記）

実装途中のスナップショット。**変更の大半は作業ツリー上にあり未コミット**（commit は R2+R1-6+R1-7 を同一コミットにまとめる計画）。

### 完了済み

| 項目 | 内容                                                                           | 状態                                                  |
| ---- | ------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------- |
| R1-1 | `admin/db/layout.tsx` の `<main>` → `<>`                                       | ✅ 適用済み                                           |
| R1-2 | `admin/db/[table]/page.tsx` を `PageShell width="wide"` でラップ               | ✅ 適用済み                                           |
| R1-3 | `src/app/admin/db/error.tsx` 新規作成                                          | ✅ 作成済み                                           |
| R1-4 | `public/{file,globe,next,vercel,window}.svg` 削除                              | ✅ 削除済み                                           |
| R1-5 | `layout.tsx` metadata に `icons: { icon: "/favicon.svg" }`                     | ✅ 適用済み                                           |
| R1-6 | `check-spec-refs.sh` をバッククォート無しパス検出に強化（`REFS_BARE`）         | ✅ 適用済み・**動作確認済み**（3 件の腐敗参照を検出） |
| R1-7 | `check-coverage-tiers.mjs` Tier 4 を `db/(repository                           | query)/.+.ts` に修正                                  | ✅ 適用済み・**Tier 4 が 73.25% PASS に** |
| R3-a | `article-card.tsx` トークン移行（`transition-all` → `transition-colors` 含む） | ✅ 適用済み                                           |
| R3-b | `news-section.tsx` トークン移行 + `role="status" aria-live="polite"` 付与      | ✅ 適用済み                                           |
| R3-c | `article-list.tsx` トークン移行（トースト色 `score-high` / `destructive`）     | ✅ 適用済み                                           |
| R3-d | `fetch-button.tsx` トークン移行                                                | ✅ 適用済み                                           |
| R3-e | `analyze-button.tsx` トークン移行                                              | ✅ 適用済み                                           |
| R3-f | `DataTable.tsx` トークン移行                                                   | ✅ 適用済み                                           |

### 未着手

| 項目 | 内容                                                                       | 残作業                                                                                                                     |
| ---- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| R2   | spec.md 同期                                                               | **Component Tree のみ更新済み**。Data Flow 図 / §7.1 Tier 5 / §7 計測表 / §3.2 Article Display / Technology Stack が未更新 |
| R3-f | `RowDetail.tsx`（24 箇所）・`Pagination.tsx`（15 箇所）                    | 直書き色のまま。計 **39 箇所** 残存                                                                                        |
| R4   | ArticleCard 再設計（Card 化・スコア左・h3・Tooltip・縦バー・keyword 削除） | 未着手（`<article>` 直書き・スコア右のまま）                                                                               |
| R4-8 | `article-list.tsx` の `<ul>/<li>` 化                                       | 未着手（`<div className="space-y-3">` のまま）                                                                             |
| R5-1 | `/bookmarks` 空状態の日本語化                                              | 未着手（`No bookmarked articles yet.` のまま）                                                                             |
| R5-2 | `ThemeToggle.test.tsx` に light / system 追加                              | 未着手（dark のみ）                                                                                                        |
| R5-3 | ヘッダーのブックマーク件数バッジ（AppHeader RSC 化）                       | 未着手                                                                                                                     |
| R5-4 | `implementation-notes.md` §6 検証結果の訂正                                | 未着手                                                                                                                     |

### 検証結果（2026-08-08 実測）

| コマンド                                    | 結果                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run`                      | **326 passed / 2 skipped（63 files）** ✅                                                      |
| `pnpm exec tsgo --noEmit`                   | EXIT=0 ✅                                                                                      |
| `pnpm run lint:fast`                        | エラー 0（警告のみ・既存） ✅                                                                  |
| `node scripts/check-coverage-tiers.mjs`     | 全ティア PASS（**Tier 4: 73.25%** / Tier 5: 92.09%） ✅                                        |
| `bash scripts/check-spec-refs.sh`（強化版） | **❌ FAIL（3 件の腐敗参照を検出）** — R1-6 が機能している証拠。R2 の残り節を更新すれば PASS に |

> ⚠️ 注: `check-spec-refs.sh` は現時点で **FAIL が正しい状態**。R2 が未完のため。
> R2（spec.md 全節）と R1-6/7 を**同一コミット**にしてから検証を通すこと。

---

## 0. 方針

検証で判明したのは「Phase 0 は完了、Phase 1 は半分、Phase 2 は 1/3」という状態。
**Phase 3 に進む前に、Phase 1 #5（トークン移行）と Phase 2 #3（カード再設計）を閉じる。**

理由: トークン移行を残したまま Phase 3 で `fetch-button.tsx` を 3 分割すると、
直書き色が 3 ファイルに増殖して置換コストが上がる。順序は計画（02 §「トークンと primitive が
揃う前に画面を触ると、また別種のユーティリティ文字列が増えるだけになる」）どおりに戻す。

---

## R1 — 構造・設定の即時修正（1 コミット / 見た目に影響しない）

**目的**: HTML 妥当性と検証スクリプトの実効性を回復する。テストは変わらないはず。

| #   | 作業                                                                                     | 対象                                      | 根拠              |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------- |
| 1   | `admin/db/layout.tsx` の `<main>` を `<>…</>` にする（`PageShell` に `<main>` を委ねる） | `src/app/admin/db/layout.tsx:8-10`        | 08 §3.1           |
| 2   | `admin/db/[table]/page.tsx` を `PageShell width="wide" title={table}` でラップ           | `src/app/admin/db/[table]/page.tsx:50-63` | 03 §3.3           |
| 3   | `src/app/admin/db/error.tsx` を新規作成（`error.tsx` と同型、`digest` 非表示）           | 新規                                      | 03 §3.4 / 08 §3.5 |
| 4   | `public/{file,globe,next,vercel,window}.svg` を削除                                      | `public/`                                 | 03 §3.5 / 08 §3.6 |
| 5   | `layout.tsx` の metadata に `icons: { icon: "/favicon.svg" }` を追加                     | `src/app/layout.tsx:27-33`                | 03 §3.5           |
| 6   | `check-spec-refs.sh` がバッククォート無しのパスも拾うようにする                          | `scripts/check-spec-refs.sh:27`           | 08 §3.4           |
| 7   | `check-coverage-tiers.mjs` の Tier 4 パターンを `db/{repository,query}/*.ts` に修正      | `scripts/check-coverage-tiers.mjs:66-71`  | 08 §3.11          |

### R1-4 の事前確認（必須）

```bash
grep -rn "next.svg\|vercel.svg\|window.svg\|globe.svg\|file.svg" src/ public/ tests/
```

### R1-6 の具体案

現状 `grep -oP '`((src|tests)/[^`]+)'` はバッククォート必須。
Component Tree はフェンス内プレーンテキストなので拾われない。2 段構えにする:

```bash
# 既存: バッククォート付き
REFS_TICK=$(grep -oP '`((src|tests)/[^`]+)' "$SPEC_FILE" | sed 's/`//g' || true)
# 追加: 裸のパス（拡張子付きのみ。誤検出を避けるため .ts/.tsx/.css/.sql/.mjs に限定）
REFS_BARE=$(grep -oP '(?<![`\w/])(src|tests)/[\w./\[\]{},*-]+\.(ts|tsx|css|sql|mjs)\b' "$SPEC_FILE" || true)
REFS=$(printf '%s\n%s\n' "$REFS_TICK" "$REFS_BARE" | sed '/^$/d')
```

> ⚠️ このスクリプト修正は **R2 より先に入れると pre-push が落ちる**。
> R1-6 と R2（spec.md 更新）は**同一コミット**にするか、R2 → R1-6 の順に入れること。

### 完了条件

- `pnpm exec vitest run` 全通過（変化なし）
- `bash scripts/check-spec-refs.sh` が **R2 適用前は落ちる**ことを確認（＝検証が効くようになった証明）
- `node scripts/check-coverage-tiers.mjs` で Tier 4 が「No files matched」を出さない

---

## R2 — `spec.md` の同期（1 コミット）

**目的**: 07 §7.4-2 の未実施分を閉じる。R1-6 とセットで意味を持つ。

| 節                              | 更新内容                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §6 Component Tree（`:192-208`） | `src/app/article-list.tsx` → `src/components/article/article-list.tsx`、`src/app/news-section.tsx` → `src/components/news/news-section.tsx`。`layout/app-header.tsx` / `app-nav.tsx` / `theme-toggle.tsx` / `page-shell.tsx`、`article/article-card.tsx` / `article-skeleton.tsx` / `score-popover.tsx`、`src/lib/ui/score.ts` を追加。`RootLayout` 直下に `ThemeProvider` / `TooltipProvider` / `AppHeader` / `Toaster` を明記 |
| データフロー図（`:219-232`）    | 同様にパス更新。`tooltip breakdown` → `Popover breakdown`                                                                                                                                                                                                                                                                                                                                                                       |
| §7.1 Tier 5（`:281`）           | 対象を `components/{article,news,layout}/*.tsx`, `fetch-button.tsx`, `refresh-context.tsx`, `admin/db/[table]/components/*.tsx` に。`check-coverage-tiers.mjs:74-82` の実パターンと一致させる                                                                                                                                                                                                                                   |
| §7 冒頭の計測表（`:264-268`）   | 「Measured (2026-07-27)」を現時点の実測（326 passed / Tier 5 92.09%）に更新                                                                                                                                                                                                                                                                                                                                                     |
| §3.2 Article Display            | スコア内訳の提示を `title` 属性 → Popover に。3 指標 + 重み表記の可視化を記述                                                                                                                                                                                                                                                                                                                                                   |
| Technology Stack（`:252-261`）  | `shadcn/ui (radix-nova)`, `Radix UI`, `next-themes`, `lucide-react`, `sonner`, `tw-animate-css` を追記                                                                                                                                                                                                                                                                                                                          |
| §9 Hidden Features              | **変更しない**（お気に入りは現状維持の決定どおり）                                                                                                                                                                                                                                                                                                                                                                              |

### 完了条件

- `bash scripts/check-spec-refs.sh` が PASS（R1-6 適用後の強化版で）
- `bash scripts/check-spec-update.sh` が警告を出さない

---

## R3 — トークン移行の完遂（Phase 1 #5 の積み残し）🔴 最重要

**目的**: README の問題意識 #2「ダークモードが実質破綻している」を実際に解消する。

**進め方**: ファイル単位で分割し、1 ファイル = 1 コミットにする。
`02 §2.4 移行ルール` の対応表を機械的に適用し、**構造は一切変えない**（差分をレビュー可能に保つ）。

### 対応表（02 §2.4 の再掲）

| Before                                 | After                                                          |
| -------------------------------------- | -------------------------------------------------------------- |
| `bg-white`                             | `bg-card`                                                      |
| `bg-neutral-50`                        | `bg-muted`（面）/ `bg-background`（地）                        |
| `text-neutral-900` / `-800` / `-700`   | `text-foreground`                                              |
| `text-neutral-600`                     | `text-muted-foreground`（強め）→ 必要なら `text-foreground/80` |
| `text-neutral-500` / `-400`            | `text-muted-foreground`                                        |
| `border-neutral-200` / `-300` / `-100` | `border-border`                                                |
| `text-red-*` / `bg-red-50`             | `text-destructive` / `bg-destructive/10`                       |
| `text-emerald-600` / `bg-green-50`     | `text-score-high` / `bg-score-high/10`                         |
| `text-blue-500` / `bg-blue-400`        | `text-primary` / `bg-primary`（アクセント用途）                |
| `hover:text-blue-600`                  | `hover:text-primary`（もしくは `group-hover:underline`）       |

### 順序と対象

| #    | ファイル                                                                   | 直書き数 | 備考                                                                                                                      |
| ---- | -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| R3-a | `src/components/article/article-card.tsx`                                  | 9        | **最優先**。`/` と `/bookmarks` の両方に効く。`transition-all duration-200` → `transition-colors`（06 §6.3）も同時に      |
| R3-b | `src/components/news/news-section.tsx`                                     | 5        | 併せて `role="status" aria-live="polite"` を付与（06 §6.1 A8）                                                            |
| R3-c | `src/components/article/article-list.tsx`                                  | 10       | トーストの成功/失敗色（`green-*` / `red-*`）。**挙動・DOM 構造・文言は変えない**（`FavoriteArticleList.test.tsx` が依存） |
| R3-d | `src/app/fetch-button.tsx`                                                 | 26       | 構造は触らない。Phase 3 の分割時に持ち越さないため色だけ先に潰す                                                          |
| R3-e | `src/app/bookmarks/analyze-button.tsx`                                     | 7        | 同上（トースト化は Phase 4）                                                                                              |
| R3-f | `src/app/admin/db/[table]/components/{DataTable,RowDetail,Pagination}.tsx` | 76       | 05 §5.2 の「構造は変えず、色クラスのトークン置換に留める」に厳密に従う                                                    |

### R3-a の注意点

`article-card.tsx` は `ArticleCard.test.tsx` / `ArticleList.test.tsx` / `FavoriteArticleList.test.tsx` が
依存している。以下は**変えない**:

- ルートの `<article>` 要素（`getAllByRole("article")` が順序検証に使用）
- 要約エリアの `onPointerDown`（5 回タップの検知領域）
- 表示文言、`--` のスコア表示、リンクの `target` / `rel`

### 完了条件

```bash
# 直書き色クラスがゼロになること
grep -rnoE "(bg|text|border)-(white|black|neutral|gray|slate|zinc|red|green|blue|emerald|amber|yellow)-?[0-9]{0,3}" \
  src --include=*.tsx | grep -v "src/components/ui/"
```

- 上記の出力が空
- `pnpm exec vitest run --coverage` 全通過（326 passed 維持）
- `.dark` を `<html>` に手動付与して 4 画面を目視 — 白カード / 黒文字の組み合わせが出ない

---

## R4 — `ArticleCard` の再設計（Phase 2 #3 の積み残し）

**目的**: 04 §4.2 の「新しいカード構造」を実装する。R3-a 完了後に着手する
（トークン化済みのコードに対して構造を変えるほうが差分が読める）。

| #   | 作業                                                                                          | 根拠                 |
| --- | --------------------------------------------------------------------------------------------- | -------------------- |
| 1   | ルートを shadcn `Card` ベースにする                                                           | 04 §4.2              |
| 2   | スコアを**左**に移す。`ml-4` 固定マージンを廃し親の `gap-3 sm:gap-4` に委ねる                 | 04 §4.2 / §4.6       |
| 3   | tier ごとに左端の縦バー（太さ or 塗り面積）を付ける — **色覚に依存しない冗長符号化**          | 04 §4.2              |
| 4   | `ScorePopover` トリガーの `aria-label` を `スコア ${score}、${SCORE_TIER_LABEL[tier]}` 形式に | 04 §4.2              |
| 5   | タイトルを `<h3>` に（`NewsSection` の `<h2>` と階層を接続）                                  | 06 §6.2              |
| 6   | `reason` を `title` 属性 → `Tooltip` 付き `ⓘ` ボタンに                                        | 04 §4.2 / 06 §6.1 A7 |
| 7   | メタ情報を `Separator` 区切りの 1 行に                                                        | 04 §4.2              |
| 8   | `ArticleList` を `<ul role="list">` / `<li>` に                                               | 06 §6.2              |
| 9   | `ArticleCardProps.keyword` のデッドプロップを削除（または使う）                               | 08 §3.9              |
| 10  | タップターゲット最小 44×44px を確認（スコアトリガーは現状 `h-11 w-11` = 44px ✅）             | 04 §4.6              |

### テスト影響 🔴

**R4-8（`<ul>/<li>` 化）と R4-5（`<h3>` 化）は既存テストを壊す可能性がある。**
着手前に以下を確認し、必要ならテスト修正を同一コミットに含める:

```bash
grep -rn "getAllByRole(\"article\")\|getByRole(\"article\"\|role=\"article\"" tests/
grep -rn "getByRole(\"heading\"" tests/components/
```

- `<li>` の中に `<article>` を置けば `getAllByRole("article")` は維持できる（推奨）
- R4-6（Tooltip 化）は `ArticleCard.test.tsx` / `ArticleList.test.tsx` の `reason` 検証に影響する

### 新規テスト（07 §7.5）

| 対象                | 追加内容                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `article-card.tsx`  | tier 別の冗長符号化（縦バー）がレンダリングされる / `<h3>` が存在する / `reason` の Tooltip が開く |
| `score-popover.tsx` | トリガーの `aria-label` に tier ラベルが含まれる                                                   |

### 完了条件

- キーボードのみで「記事を開く / スコア内訳を見る / reason を読む」がすべて可能
- `getAllByRole("article")` ベースの既存テストが通る（または同一コミットで更新済み）
- Tier 5 が 80% 以上を維持

---

## R5 — 積み残しの小粒（任意・R3/R4 と同時でも可）

| #   | 作業                                                                         | 根拠               |
| --- | ---------------------------------------------------------------------------- | ------------------ |
| 1   | `/bookmarks` 空状態の英語 `No bookmarked articles yet.` を日本語に           | 05 §5.1 / 08 §3.8  |
| 2   | `ThemeToggle.test.tsx` に light / system の 2 ケースを追加（現状 dark のみ） | 07 §7.5 / 08 §3.10 |
| 3   | ヘッダーのブックマーク件数バッジ（`<Suspense>` + RSC `BookmarkCountBadge`）  | 03 §3.2 / 08 §3.7  |
| 4   | `docs/implementation-notes.md` の §6 検証結果を訂正（08 §4.2 の 3 点）       | 08 §4.2            |

### R5-3 の設計メモ

現状 `app-header.tsx:1` が `"use client"` だが、`AppHeader` 自体にクライアント要素はない
（`AppNav` / `ThemeToggle` が個別に `"use client"` を持つ）。

1. `app-header.tsx` から `"use client"` を外す
2. `AppHeader` を RSC にして `<Suspense fallback={null}><BookmarkCountBadge /></Suspense>` を埋める
3. `BookmarkCountBadge` は `getFavoriteArticlesCached()` の件数を `Badge` で表示

> `@sbougerel/eslint-plugin-next-use-client-boundary` が境界を検証してくれる（06 §6.4）。
> `pnpm run lint` で確認すること。

---

## 実行順序とコミット計画

```
R2 (spec.md 同期)
  └─ R1 (構造・設定修正 / R1-6 のスクリプト強化を含む)     ← 同一 PR、R2 を先に
       └─ R3-a … R3-f (トークン移行 / 1 ファイル 1 コミット)  ← 🔴 最重要
            └─ R4 (ArticleCard 再設計 + テスト更新)
                 └─ R5 (小粒)
                      └─ ここで初めて Phase 3 に進む
```

**各コミット前に必ず**:

```bash
pnpm exec tsgo --noEmit
pnpm run lint:fast
pnpm exec vitest run --coverage && node scripts/check-coverage-tiers.mjs
bash scripts/check-spec-refs.sh
```

---

## 是正後に残る「未計測」項目

以下は自動化できないため、R4 完了時点で**手動で 1 回**実施し、結果を
`docs/implementation-notes.md` に追記する（07 §7.6 の完了条件のうち計測系）:

| 項目                           | 手順                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ライト/ダーク目視（4 画面）    | DevTools で `<html class="dark">` を強制。`/`, `/bookmarks`, `/admin/db`, `/admin/db/articles`                                                |
| Lighthouse Accessibility = 100 | Chrome DevTools。ライト/ダーク両方                                                                                                            |
| CLS < 0.1                      | Lighthouse。特に `loading.tsx` → 実描画の遷移                                                                                                 |
| First Load JS +30KB 以内       | Next.js 16 はビルド出力にサイズ表を出さないため、`.next/static/chunks/` の合計サイズを刷新前後で比較するか `@next/bundle-analyzer` を一時導入 |
| Geist / Noto Sans JP の適用    | ✅ **検証済み**（08 §2 Phase 0）。ビルド CSS の `@font-face` で確認済みなので再計測不要                                                       |
