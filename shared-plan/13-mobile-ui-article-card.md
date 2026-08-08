# 記事カードのモバイルUI改善（スコア領域の圧縮 + 選定理由の全文表示）

## Context

記事一覧（`ArticleCard`）はモバイル/PC共通の固定レイアウトで、レスポンシブ対応（`sm:`等のブレークポイント）が一切使われていない。ユーザーから以下2点の指摘があった:

1. モバイルで「点数」表示領域（スコアボタン + gap + カード余白）が相対的に広く、記事タイトル/本文のテキスト領域を圧迫している。
2. 「選定理由」(`reason`)はJS側で `reason.slice(0, 30)}…` と手動で30文字に切り詰めた上、Radix `Tooltip`（ホバー/フォーカスで表示）に全文を入れているため、**ホバー操作ができないモバイルでは全文を確認する手段が実質存在しない**。

対象ファイル:

- `src/components/article/article-card.tsx`（カード全体のレイアウト、選定理由の表示）
- `src/components/article/score-popover.tsx`（スコアボタンのサイズ）

このプロジェクトの `src/components/ui/` には `accordion` / `collapsible` は存在しないが、`Popover`（`ui/popover.tsx`、Radix Popoverラッパー）は既にスコア内訳表示（`ScorePopover`）でタップ開閉のパターンとして使われている。理由の全文表示にもこの既存パターンをそのまま再利用するのが最も一貫性がある。

## 修正方針

### 1. スコア領域をモバイルで縮小（レスポンシブ化）

`article-card.tsx` の `article` ルート要素とスコア列、および `score-popover.tsx` のボタンサイズに `sm:` ブレークポイントを追加し、モバイル時のみコンパクトにする。PC表示は現状維持。

- `article-card.tsx` L73: `flex gap-4 p-4 h-full` → `flex gap-3 p-3 sm:gap-4 sm:p-4 h-full`
- `article-card.tsx` L75: スコア列の `gap-2` → `gap-1.5 sm:gap-2`
- `article-card.tsx` L76: tier bar `w-1 h-12` → `w-1 h-10 sm:h-12`
- `score-popover.tsx` L59（null時プレースホルダ）: `h-11 w-11 ... text-xs` はモバイル/PC共通のまま据え置き（元々小さいtext-xsなので変更不要）だが、サイズは本体ボタンと合わせて `h-10 w-10 sm:h-11 sm:w-11` に統一
- `score-popover.tsx` L82: ボタンの `h-11 w-11 ... text-lg` → `h-10 w-10 sm:h-11 sm:w-11 ... text-base sm:text-lg`

これによりモバイル幅でスコア列が数px〜十数px分コンパクトになり、テキスト領域（`min-w-0 flex-1`側、既に正しく残り幅を使う実装になっている）に還元される。

### 2. 選定理由をタップで全文表示（Tooltip → Popover に置き換え）

`article-card.tsx` の reason 表示部分（L124-141）を、`Tooltip`ベースのhoverのみの実装から、`Popover`ベースのタップ開閉に変更する。`ScorePopover`と同じ`Popover`/`PopoverContent`/`PopoverTrigger`（`@/components/ui/popover`）を使い、一貫したインタラクションにする。

- import を `Tooltip, TooltipContent, TooltipTrigger` (`@/components/ui/tooltip`) から `Popover, PopoverContent, PopoverTrigger` (`@/components/ui/popover`) に変更
- トリガーボタンのラベル表示は手動 `reason.slice(0, 30)}…` をやめ、CSSの `truncate`（+ 適切な `max-w-*`）で省略表示に変更（単語の途中で不自然に切れるのを避け、画面幅に応じて自然に省略される）
  - 例: `<span className="italic truncate max-w-[8rem] sm:max-w-[12rem]">{reason}</span>`
- `PopoverContent` に `reason` の全文をそのまま表示（`w-72 text-sm leading-relaxed` 程度、Popover側はデフォルトで `w-72` かつRadixが画面端との衝突を自動回避するためモバイルでもはみ出さない）
- タップで開閉するため、モバイルでも選定理由の全文を確認できるようになる

## 検証方法

1. `pnpm dev` で開発サーバーを起動。
2. ブラウザでモバイル幅（例: 375px）に切り替え、記事一覧を表示。
   - スコアボタンとタイトル/本文のバランスが改善されていること（テキスト領域が広くなっていること）を目視確認。
   - 「選定理由」の `HelpCircle` ボタンをタップし、Popoverで全文が表示されることを確認（ホバーなしでも動作すること）。
   - 元のスコア内訳Popover（スコアボタンタップ）の挙動に影響がないことを確認。
3. デスクトップ幅でも同様に確認し、レイアウト崩れがないこと・スコアボタンサイズが従来通り(44px)であることを確認。
4. `pnpm lint` / `pnpm build` を実行し、型エラー・lintエラー（未使用importのTooltip関連含む）がないことを確認。

## 実行結果（2026-08-09）

### 実装内容

1. **スコア領域のレスポンシブ化** — `article-card.tsx` のルート要素・スコア列・tier bar、および `score-popover.tsx` のボタン/プレースホルダに `sm:` ブレークポイントを追加し、モバイル時のみコンパクト化（PC は従来の 44px を維持）。
2. **選定理由の Tooltip → Popover 化** — `article-card.tsx` の reason 表示を Radix `Popover`（`@/components/ui/popover`）ベースのタップ開閉に変更。手動 `reason.slice(0, 30)}…` を廃止し、CSS `truncate` + `max-w-[8rem] sm:max-w-[12rem]` による自然な省略表示に変更。`PopoverContent` に全文を表示（`w-72 text-sm leading-relaxed`）。
3. **テスト追加** — `tests/components/ArticleCard.test.tsx` に「reason が Popover で表示され、クリックで開く」テストを追加（`fireEvent.click` で開閉を検証）。
4. **spec.md 更新** — コンポーネントツリーの `ArticleCard` 記述を「mobile compact score area」「Reason (Popover on ⓘ button, tap to open full text)」に更新。

### 検証結果

| チェック                                                     | 結果                                   |
| ------------------------------------------------------------ | -------------------------------------- |
| `pnpm run lint:fast`                                         | ✅ error 0（warning は既存のもののみ） |
| `pnpm exec tsgo --noEmit`                                    | ✅ パス                                |
| `pnpm exec vitest run`                                       | ✅ 336 passed / 2 skipped（65 files）  |
| `pnpm exec vitest run tests/components/ArticleCard.test.tsx` | ✅ 2 passed                            |

### コミット・プッシュ

- コミット: `caf4ec9` `feat(ui): ArticleCard モバイルUI改善 — スコア領域のレスポンシブ化と選定理由のPopover化`
- 対象: `openspec/specs/news-watch/spec.md` / `src/components/article/article-card.tsx` / `src/components/article/score-popover.tsx` / `tests/components/ArticleCard.test.tsx` / `shared-plan/13-mobile-ui-article-card.md`
- pre-commit フック（lint-staged）通過
- pre-push フック全通過:
  - spec 参照検証 ✅
  - スキーマ整合性 ✅
  - カバレッジ Tier 検証 ✅（Tier 1: 100% 〜 Tier 6: 90.79%）
  - 本番スキーマ整合 ✅
- プッシュ: `db54497..caf4ec9 master -> master`
