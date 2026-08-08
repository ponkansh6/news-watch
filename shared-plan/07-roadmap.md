# 07. 実行計画

## 7.1 フェーズ

各フェーズは**独立して commit / push できる**単位。pre-push のカバレッジ検証を
通せる状態で区切る。

---

### Phase 0 — 基盤の据え付け（土台）

**目的**: shadcn/ui とトークンを入れ、既存画面を壊さない状態で止める。

| #   | 作業                                                                   | 対象                                  |
| --- | ---------------------------------------------------------------------- | ------------------------------------- |
| 1   | `pnpm dlx shadcn@latest init -d --base radix`                          | `components.json`, `src/lib/utils.ts` |
| 2   | `globals.css` を §2.2 の形に手当て（**フォントのリテラル名化が必須**） | `src/app/globals.css`                 |
| 3   | `body { font-family: Arial… }` を削除                                  | `src/app/globals.css:25`              |
| 4   | `@media (prefers-color-scheme: dark)` を `.dark` クラス方式へ          | `src/app/globals.css:15-20`           |
| 5   | Noto Sans JP を追加                                                    | `src/app/layout.tsx`                  |
| 6   | `next-themes` + `ThemeProvider` を導入                                 | `src/app/layout.tsx`                  |
| 7   | primitive を一括追加（§2.1 のリスト）                                  | `src/components/ui/**`                |
| 8   | カバレッジ除外に `src/components/ui/**` を追加                         | `vitest.config.ts`                    |
| 9   | `lucide-react` を `optimizePackageImports` に追加                      | `next.config.ts`                      |

**完了条件**: 既存テスト全通過 / 見た目が現状とほぼ同じ / `.dark` を手で付けても崩れない
（この時点ではまだ崩れる。Phase 1 で直す）

**注意**: 手順 2 は必ず手動確認する。`shadcn init` は `globals.css` を上書きし、
`--font-sans: var(--font-sans)` という循環参照を仕込むことが知られている。
本プロジェクトは既に同種の壊れ方をしている（[01 §A](./01-current-state.md)）。

---

### Phase 1 — アプリシェルとトークン移行

**目的**: 全画面を共通シェルに乗せ、色をトークンへ置換してダークモードを成立させる。

| #   | 作業                                                         | 対象                                                |
| --- | ------------------------------------------------------------ | --------------------------------------------------- |
| 1   | `AppHeader` / `AppNav` / `ThemeToggle` を作成                | `src/components/layout/**`（新規）                  |
| 2   | `PageShell` を作成                                           | `src/components/layout/page-shell.tsx`（新規）      |
| 3   | 3 画面を `PageShell` に載せ替え                              | `page.tsx`, `bookmarks/page.tsx`, `admin/db/**`     |
| 4   | 独自シェルを削除                                             | `bookmarks/page.tsx:13`, `admin/db/layout.tsx:9-19` |
| 5   | 全ファイルの色クラスをトークンへ一括置換（§2.4 の対応表）    | 全 UI ファイル                                      |
| 6   | `sonner` の `<Toaster />` を配置、手書きトーストを削除       | `layout.tsx`, `article-list.tsx:145-168`            |
| 7   | `error.tsx` / `not-found.tsx` / `bookmarks/loading.tsx` 追加 | `src/app/**`（新規）                                |
| 8   | `loading.tsx` を `PageShell` ベースで作り直す                | `src/app/loading.tsx`                               |
| 9   | メタデータ拡充、`public/` の残骸削除                         | `layout.tsx`, `public/`                             |

**完了条件**: ライト/ダーク両方で全画面が破綻しない（目視 + Lighthouse a11y）

---

### Phase 2 — 記事体験の再設計 ★中核

**目的**: このアプリの価値（スコアと理由）を可視化する。
（お気に入りは **現状維持** のため対象外）

| #   | 作業                                                   | 対象                                      |
| --- | ------------------------------------------------------ | ----------------------------------------- |
| 1   | `src/lib/ui/score.ts`（純関数）を切り出し + 単体テスト | 新規                                      |
| 2   | `ScoreBadge` → `ScorePopover` + `ScoreBreakdown`       | `src/components/article/**`               |
| 3   | `ArticleCard` を `Card` ベースで再構成、`<ul>/<li>` 化 | `src/components/article/article-card.tsx` |
| 4   | キーワードチップを `Badge variant="secondary"` に統一  | `article-list.tsx:56-74` を削除           |
| 5   | ファイル移動（`src/app/*.tsx` → `src/components/**`）  | 下記 §7.4 の追随作業が必須                |

**完了条件**: キーボードのみで「記事を開く / スコア内訳を見る」が可能
（お気に入り登録は現状維持のため対象外）

---

### Phase 3 — ツールバーと更新体験

| #   | 作業                                                    | 対象                             |
| --- | ------------------------------------------------------- | -------------------------------- |
| 1   | ソース選択を URL + Cookie 駆動へ（localStorage 廃止）   | `page.tsx`, `source-filter.tsx`  |
| 2   | マウント時 `router.replace()` を削除                    | `fetch-button.tsx:40-47`         |
| 3   | `fetch-button.tsx` を 3 コンポーネントへ分割            | `src/components/news/**`         |
| 4   | 更新中はリストを消さず減光 + `aria-busy`                | `news-section.tsx:48-49`         |
| 5   | 解除タイマーを 1 本の安全弁に集約                       | `fetch-button.tsx:51-57,137-140` |
| 6   | `isFiltering` を `useTransition` に置換、Context を縮小 | `refresh-context.tsx`            |
| 7   | 空状態を designed empty state へ（一次アクション同梱）  | `news-section.tsx:50-56`         |

**完了条件**: 初回描画でソースがちらつかない / 更新中も既存記事が読める

---

### Phase 4 — `/bookmarks`

[05-bookmarks-admin.md §5.1](./05-bookmarks-admin.md) の内容。
嗜好プロファイルカードの再構成、`AnalyzeButton` のトースト化、
再分析導線の `Alert` 化。

---

### Phase 5 — `/admin/db` と仕上げ

[05 §5.2](./05-bookmarks-admin.md) の `Table` / `Sheet` / `pagination` 置換、
キーボードショートカット（[06 §6.2](./06-accessibility-motion.md)）、
Lighthouse の前後比較。

---

## 7.2 既存テストへの影響（確認済み）

**壊れることが確定している箇所**:

| テスト                                     | 依存                                                              | 影響 Phase | 対応                                       |
| ------------------------------------------ | ----------------------------------------------------------------- | ---------- | ------------------------------------------ |
| `ArticleList.test.tsx:77`                  | `container.querySelector("span[title*='関連性: ']")`              | Phase 2    | Popover を開いて内訳を検証する形へ書き換え |
| `AnalyzeButton.test.tsx:73,90`             | メッセージのインライン表示                                        | Phase 4    | sonner 検証へ                              |
| `AnalyzeButton.test.tsx:33`                | `getByText(/お気に入りが5件以上で…/)`                             | Phase 4    | Tooltip 化に伴い書き換え                   |
| `FetchButton.test.tsx:94,105,117`          | `getByRole("combobox") as HTMLSelectElement` + `fireEvent.change` | Phase 3    | §7.3 参照                                  |
| `FetchButton.test.tsx:316,323,396,405,419` | `getByText("(2件)")` / `("(更新中...)")`                          | Phase 3    | 見出しサフィックス形式変更に伴い書き換え   |
| `NewsSection.test.tsx`                     | 空状態の文言/構造                                                 | Phase 3    | 新しい空状態に合わせる                     |

> **お気に入りは現状維持のため、`FavoriteArticleList.test.tsx` は影響を受けない**
> （5 連打の隠しトグルと手書きトーストをそのまま維持するため）。

**壊れない箇所**: `getByText("テスト記事 1")` / `getByRole("link", …)` /
`getByRole("button", { name: "ニュースを取得してスコアリング" })` など、
文言とロールに依存したものは維持される。**リファクタ中はこれらの文言を変えない**
（変えたくなったら、テスト修正とセットで別コミットにする）。

`tests/components/` 以外（`tests/lib`, `tests/db`, `tests/api`, `tests/news`, `tests/e2e`）は
UI 刷新の影響を受けない。

## 7.3 Radix Select の判断ポイント 🔴

`FetchButton.test.tsx:94-117` は**ネイティブ `<select>` を前提**にしている:

```ts
const select = screen.getByRole("combobox") as HTMLSelectElement;
fireEvent.change(select, { target: { value: "qiita" } });
```

Radix Select は `<button role="combobox">` を描画し、オプションは開いたときだけ
DOM に現れる。さらに happy-dom では `PointerEvent` / `ResizeObserver` /
`scrollIntoView` のポリフィルが必要で、テストが不安定になりやすい。

**推奨**: **ネイティブ `<select>` を維持し、shadcn のスタイルだけ当てる。**

```tsx
<Label htmlFor="source-select">データソース</Label>
<select id="source-select"
        className={cn(
          "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm",
          "shadow-xs transition-colors focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        )}>
```

理由:

- ソース選択は**単純な単一選択**で、Radix の機能（検索、グループ、カスタム描画）が不要
- モバイルではネイティブ select の方が体験が良い（OS のホイール UI）
- 既存テスト 3 箇所がそのまま通る
- a11y はネイティブが最も確実（`<label htmlFor>` を付ければ十分）

Radix Select が本当に必要になった時点で移行する。その際は
`tests/setup-env.ts` にポリフィル追加が必要になる。

## 7.4 ファイル移動に伴う追随作業 🔴

Phase 2 で `src/app/*.tsx` → `src/components/**` へ移動する場合、
**移動と同一コミットで**以下を更新しないと pre-push が壊れる:

### 1. `scripts/check-coverage-tiers.mjs:74-82`

Tier 5 のパターンがファイル名決め打ち:

```js
patterns: [
  /\/article-list\.tsx$/,
  /\/news-section\.tsx$/,
  /\/fetch-button\.tsx$/,
  /\/feed-dashboard\.tsx$/,
  /\/refresh-context\.tsx$/,
],
```

- `fetch-button.tsx` を分割 → 新ファイル名を追加
- `refresh-context.tsx` を削除 → パターンから外す
- ディレクトリ配下をまとめて対象にするなら `/components\/(article|news|layout)\/.+\.tsx$/`

> `aggregateCoverage()` は該当ファイルが 0 件だと `null` を返す。
> パターンが 1 つも当たらないと**エラーにならず素通りする**ため、
> 更新漏れに気づけない。更新後は必ず
> `pnpm exec vitest run --coverage && node scripts/check-coverage-tiers.mjs` を
> 手で実行し、Tier 5 に想定どおりのファイル数が出ることを確認する。

### 2. `openspec/specs/news-watch/spec.md`

| 節                   | 更新内容                                           |
| -------------------- | -------------------------------------------------- |
| §6 Component Tree    | `src/app/` 直下前提の記述を新構成に置換            |
| §7.1 Tier 5          | 対象ファイルのパスを更新                           |
| §9 Hidden Features   | お気に入りは現状維持のため変更不要                 |
| §3.2 Article Display | スコア内訳の提示方法（Popover）を反映              |
| Technology Stack     | shadcn/ui, Radix, next-themes, lucide-react を追記 |

`scripts/check-spec-update.sh` が未更新を警告する（ブロックはしない）が、
`scripts/check-spec-refs.sh` は **spec.md 内の `src/` パス参照の実在を検証し、
腐敗していると pre-push を落とす**。ファイル移動時は必ず spec.md のパスを直すこと。

### 3. `vitest.config.ts`

```ts
coverage: {
  exclude: [
    "src/**/*.d.ts",
    "src/lib/db/migrations/**",
    "src/lib/db/index.ts",
    "src/components/ui/**",   // ← 追加: shadcn 生成物はテスト対象外
  ],
}
```

これを入れないと、shadcn の primitive 群（未テスト）が全体カバレッジを押し下げる。

## 7.5 新規に必要なテスト

Tier 5（>80%）を維持するため、新規コンポーネントに以下を用意する:

| 対象                  | テスト内容                                                   |
| --------------------- | ------------------------------------------------------------ |
| `src/lib/ui/score.ts` | 境界値（`null` / 4.9 / 5 / 7.9 / 8 / 10）の tier 判定        |
| `score-popover.tsx`   | トリガーのクリックで内訳が表示される / `aria-label` が正しい |
| `source-filter.tsx`   | 値変更で正しい URL へ遷移する                                |
| `app-nav.tsx`         | 現在ページに `aria-current="page"` が付く                    |
| `theme-toggle.tsx`    | 3 状態の切替（`next-themes` はモックする）                   |
| `article-card.tsx`    | スコアなし / 要約なし / キーワードなしの各欠損パターン       |

`src/components/layout/**` と `src/components/article/**` は Tier 5 に追加する
（§7.4 の 1 と併せて）。

## 7.6 完了条件

| 項目                                                      | 検証方法                                |
| --------------------------------------------------------- | --------------------------------------- |
| ライト/ダーク両方で全 4 画面が破綻しない                  | 目視 + `.dark` 強制                     |
| Lighthouse Accessibility = 100（ライト/ダーク両方）       | Chrome DevTools                         |
| キーボードのみで全機能に到達可能                          | Tab 走査、`f`/`Enter` 操作              |
| CLS < 0.1（loading → 実描画）                             | Lighthouse                              |
| `pnpm exec vitest run --coverage` 全通過 + Tier 全達成    | `node scripts/check-coverage-tiers.mjs` |
| `pnpm run lint:fast` / `pnpm exec tsgo --noEmit` クリーン | pre-commit                              |
| `spec.md` の `src/` 参照が全て実在                        | `bash scripts/check-spec-refs.sh`       |
| Geist + Noto Sans JP が実際に適用されている               | DevTools の Computed → `font-family`    |
| First Load JS が刷新前 +30KB 以内                         | `pnpm build` の出力を前後比較           |

## 7.7 やらないこと

- **仮想スクロール** — 100 件では過剰。実測で問題が出てから
- **アニメーションライブラリ（framer-motion 等）の追加** — `tw-animate-css` で足りる
- **チャート/可視化ライブラリ** — スコア内訳のバーは CSS で十分
- **PWA / Service Worker** — 現在の用途に対して複雑さが見合わない
- **i18n** — 日本語単一で運用されている
- **`/admin/db` の大規模作り直し** — 内部ツール。トークン追従で止める
