# 記事一覧 UI 再構築 — モバイル最優先・横幅最大化

## Context

直近のコミット caf4ec9 でモバイル向けの調整（スコア領域のレスポンシブ化、選定理由の Popover 化）を入れたが、**構造そのものは「左にスコア列、右に本文」の2カラムのまま**で、横幅の食われ方が変わっていない。

iPhone SE (375px) での実測内訳:

| 消費                                 | px                |
| ------------------------------------ | ----------------- |
| `PageShell` の `px-4`                | 32                |
| `Card` の ring                       | 2                 |
| `<article>` の `p-3`                 | 24                |
| スコア列（`ScorePopover` の `w-10`） | 40                |
| `gap-3`                              | 12                |
| **本文に残る幅**                     | **265px (70.7%)** |

約30%が枠とスコアに食われている。加えて `Card` の `py-(--card-spacing)`（= py-4）と `<article>` の `p-3` が二重にかかっており、1枚あたり縦にも 28px 無駄がある。

一方で **スコアの数値そのものは優先度が低い**（並び順に効いていれば十分で、一覧で数字を凝視することはない）。そこでスコアを「レイアウト幅を消費しない表現」に降格し、空いた幅を本文に回す。

**ゴール:** モバイルでの本文幅 265px → **351px (93.6%)**。情報は1つも落とさない（スコア数値も内訳 Popover も残す）。

## 決定事項

| 論点         | 採用                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| スコア       | 左端に 3px の全高アクセントバーを `absolute` 配置（レイアウト幅ゼロ）。数値はメタ行に小さく置き、タップで従来どおり内訳 Popover         |
| モバイルの枠 | 全幅フィード化。リストを `-mx-4 sm:mx-0` でブリードさせ、モバイルは枠なし `divide-y` の区切りリスト。`sm:` 以上は従来のカード表示に戻す |
| 本文         | タイトル2行維持・要約を2行 → **3行**                                                                                                    |

## 変更内容

### 1. `src/components/article/article-card.tsx`（主対象）

- **左カラムを撤去。** `<div className="shrink-0 flex flex-col ...">` ごと削除し、`<article>` を単一カラムに。
- **`Card` の import を外し、`<li>` 自体をカード面にする。** `Card` の `py-(--card-spacing)` 二重パディングと `rounded-xl` がモバイルのブリードと噛み合わないため。

  ```tsx
  <li className="relative bg-card transition-colors sm:overflow-hidden sm:rounded-xl sm:ring-1 sm:ring-foreground/10 sm:hover:shadow-sm">
    <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", barColor)} />
    <article className="px-3 py-3 sm:px-4 sm:py-3.5">
  ```

  `barColor` の算出（`scoreTier` → `bg-score-high/mid/low` / `bg-muted`）は既存ロジックをそのまま流用。`src/lib/ui/score.ts` の `scoreTier` を引き続き使う。

- **要約** `line-clamp-2` → `line-clamp-3`。タイトルは `line-clamp-2` のまま。
- **`Separator` の `my-3` → `my-2`**（縦の回収）。
- **メタ行を1行固定に。** 現状 `flex flex-wrap items-center gap-2` はモバイルで2〜3行に折り返している。`flex items-center gap-1.5 text-xs min-w-0`（`flex-wrap` を外す）に変更し、並びは:

  `[スコア] · [ソース] · [MM/DD] · [キーワードBadge] · [ⓘ 選定理由]`

  - スコア/ソース/日付/Badge に `shrink-0`、Badge には `max-w-[6rem] truncate`
  - 選定理由のボタンに `min-w-0 flex-1`、内側 span は `truncate`。**固定幅 `max-w-[8rem] sm:max-w-[12rem]` は削除**（flex-1 で残り幅を全部使う方が広い）

- **`formatDate` を MM/DD に短縮**（`year` を落とす）。約 62px → 38px の回収。完全な日付は `<time dateTime={publishedAt}>` に残っているので、加えて `title` 属性にも入れる。年を出す/出さないを「今年かどうか」で分岐させるとサーバ/クライアントで結果がずれ得るので、**常に MM/DD の固定挙動**にする。
- **`onPointerDown` はタイトル＋要約のラッパー div に付いたまま維持**（`article-list.tsx` の5連打お気に入り隠し機能が依存）。`props-must-be-serializable` の eslint-disable コメントも維持。

### 2. `src/components/article/score-popover.tsx`

**トリガーの見た目だけを差し替える。** `aria-label`（`スコア 8.4、高スコア。内訳を表示します`）と textContent（`8.4`）、null 時の `--` テキストは変えない — `tests/components/ScorePopover.test.tsx` の3テストと `ArticleCard.test.tsx` の null スコアアサーションがそのまま通る。

- トリガー button: `h-10 w-10 sm:h-11 sm:w-11 ... rounded-lg ... text-base sm:text-lg` → `inline-flex shrink-0 items-center rounded px-1 font-mono text-xs tabular-nums font-semibold` + 既存の `textColorClass`。hover/focus-visible の指定は残す。
- null 時の `<div>` も同じく `inline-flex shrink-0 ... text-xs text-muted-foreground` の小さい表示に（`bg-muted` の四角は不要）。
- `ScoreBreakdown` と `PopoverContent className="w-64"` は**無変更**。

### 3. `src/components/article/article-list.tsx`

`<ul>` にブリードと区切りを追加:

```tsx
className={`-mx-4 divide-y divide-border sm:mx-0 sm:divide-y-0 sm:space-y-3 ${isLoading ? "opacity-60 pointer-events-none" : ""}`}
```

`-mx-4` は `PageShell` のモバイル `px-4` をちょうど打ち消す。`sm:` では `PageShell` が `px-6` になりカードも復活するので `mx-0` に戻す。`role="list"` / `aria-busy` はそのまま。

### 4. `src/components/article/article-skeleton.tsx`

現状 `gap-4 p-4` / `h-12 w-1` / `h-11 w-11` で **caf4ec9 のレスポンシブ化が反映されておらず**、実カードとサイズがずれている。今回の新レイアウトに合わせて作り直す:

- `SkeletonCard`: `Card` を外し `<article className="px-3 py-3 sm:px-4 sm:py-3.5">` に。スコア列のプレースホルダを削除し、タイトル2本＋要約3本＋メタ1本の横棒に。
- `SkeletonList`: `<ul>` に `article-list.tsx` と同じブリード＋`divide-y` を適用。`<li role="status">` の構造は維持（`tests/components/NewsSection.test.tsx` が li 数を見ている）。

### 5. `src/app/loading.tsx`（任意・推奨）

汎用の `h-32 w-full` ブロック3枚を並べているだけで実レイアウトと無関係。`SkeletonList` に差し替えると初回描画のガタつきが減る。

### 6. `src/components/layout/app-header.tsx`（任意）

ヘッダーが `max-w-6xl`、本文の `PageShell` が `max-w-4xl` で不揃い。`max-w-4xl` に合わせるとデスクトップでロゴ・ナビと記事列の左右端が揃う。モバイルには影響しない。

## 変更後の横幅予算（375px）

| 消費                  | px                |
| --------------------- | ----------------- |
| `<article>` の `px-3` | 24                |
| アクセントバー        | 0（`absolute`）   |
| **本文に残る幅**      | **351px (93.6%)** |

回収 +86px（+32%）。縦は `Card` の二重パディング解消と `Separator` の `my-2` 化で1枚あたり約 −22px、要約 +1行で約 +20px なので実質ほぼ等価のまま情報量が増える。

## 検証

1. `pnpm test` — `ArticleCard.test.tsx` / `ScorePopover.test.tsx` / `NewsSection.test.tsx` が**無改修で通ること**が設計上の制約。落ちたら「見た目だけ変える」原則から外れたサインなので、テストを書き換える前に実装を見直す。
2. `pnpm lint` — Server/Client 境界の `props-must-be-serializable` 検査（`onPointerDown`）が通ること。
3. `pnpm type-check`
4. `pnpm dev` → DevTools のデバイスツールバーで **375px / 390px / 768px / 1280px** を確認:
   - 375px: 記事テキストが画面端 12px まで届いている / メタ行が1行に収まり選定理由が残り幅いっぱいに truncate / 左端のティアバーが見えている
   - 768px 以上: カード枠・角丸・ring・カード間の余白が従来どおり復活している
   - スコア数値タップ → 内訳 Popover、ⓘ タップ → 選定理由全文 Popover の両方が開く
   - 未スコア記事（score = null）で `--` が出て、左バーが `bg-muted` になる
   - タイトル/要約を5連打してお気に入りトーストが出る（`/api/favorites/toggle`）
   - `/bookmarks` も同じ `ArticleList` を使うので同時に確認
5. `pnpm build`

## 実行結果（2026-08-09）

### 実装内容

1. **`article-card.tsx`** — 左スコア列を撤去し `<article>` を単一カラム化。`Card` を外して `<li>` 自体をカード面に（`bg-card` + `sm:` のみ ring/角丸/shadow）。左端に 3px の全高アクセントバーを `absolute` 配置（レイアウト幅ゼロ）。要約を `line-clamp-3` に、`Separator` を `my-2` に。メタ行を `flex items-center gap-1.5 text-xs min-w-0` の1行固定にし、並びを `[スコア] · [ソース] · [MM/DD] · [キーワードBadge] · [ⓘ 選定理由]` に変更。`formatDate` を MM/DD 固定に短縮し、完全日付は `<time title={publishedAt}>` に保持。選定理由ボタンは `min-w-0 flex-1` で残り幅を全部使い、内側 span を `truncate`（固定 `max-w-*` は削除）。
2. **`src/components/article/score-popover.tsx`** — トリガーを `inline-flex shrink-0 items-center rounded px-1 font-mono text-xs tabular-nums font-semibold` のコンパクト表示に。null 時も `--` の小さい `<div>` に（button のまま）。`aria-label` / textContent / `ScoreBreakdown` / `PopoverContent w-64` は無変更。
3. **`src/components/article/article-list.tsx`** — `<ul>` に `-mx-4 divide-y divide-border sm:mx-0 sm:divide-y-0 sm:space-y-3` を適用（モバイル全幅フィード化、`sm:` で従来カード表示に復帰）。
4. **`src/components/article/article-skeleton.tsx`** — `Card` を外し `<article className="px-3 py-3 sm:px-4 sm:py-3.5">` に。スコア列プレースホルダを削除し、タイトル2本＋要約3本＋メタ1本の横棒に。`SkeletonList` にも同じブリード＋`divide-y` を適用。
5. **`src/app/loading.tsx`** — 汎用ブロック3枚を `SkeletonList` に差し替え。
6. **`src/components/layout/app-header.tsx`** — `max-w-6xl` → `max-w-4xl`（PageShell と左右端を揃える）。
7. **`openspec/specs/news-watch/spec.md`** — コンポーネントツリーの `ArticleCard` / `Summary` / メタ行 / `ScorePopover` 記述を新レイアウトに更新。

### 検証結果

| チェック                                                                                    | 結果                                   |
| ------------------------------------------------------------------------------------------- | -------------------------------------- |
| `pnpm run lint:fast`                                                                        | ✅ error 0（warning は既存のもののみ） |
| `pnpm exec tsgo --noEmit`                                                                   | ✅ パス                                |
| 対象5テスト（ArticleCard / ScorePopover / NewsSection / ArticleList / FavoriteArticleList） | ✅ 23 passed（**無改修**）             |
| `pnpm exec vitest run`                                                                      | ✅ 336 passed / 2 skipped（65 files）  |
| `pnpm build`                                                                                | ✅ パス                                |

設計上の制約どおり、`ArticleCard.test.tsx` / `ScorePopover.test.tsx` / `NewsSection.test.tsx` / `ArticleList.test.tsx` / `FavoriteArticleList.test.tsx` は**一切変更せず**に全テストが通過した（「見た目だけ変える」原則を維持）。

### コミット・プッシュ

- コミット: `feat(ui): 記事一覧をモバイル最優先レイアウトに再構築 — 全幅フィード化とスコアのアクセントバー化`
- 対象: `openspec/specs/news-watch/spec.md` / `src/app/loading.tsx` / `src/components/article/article-card.tsx` / `src/components/article/article-list.tsx` / `src/components/article/article-skeleton.tsx` / `src/components/article/score-popover.tsx` / `src/components/layout/app-header.tsx` / `shared-plan/14-mobile-first-feed-layout.md`
- pre-commit フック（lint-staged）通過
- pre-push フック全通過:
  - spec 参照検証 ✅
  - スキーマ整合性 ✅
  - カバレッジ Tier 検証 ✅
  - 本番スキーマ整合 ✅
- プッシュ: `master -> origin/master`
