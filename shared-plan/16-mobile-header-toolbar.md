# ヘッダーとツールバーのモバイル最適化（重複表記の排除）

## Context

プラン14・15で記事一覧そのものはモバイル最適化された（本文幅 351px / 93.6%、カード境界の可視化）。一方で**記事の上に載っているシェル部分（ヘッダー + ツールバー + 見出し）は一度も手を入れていない**。ユーザーから4点の指摘:

1. ヘッダーのメニューボタンの配置がモバイル最適化されていない
2. データソースのピックリストと「〜ソース」の記載が重複している
3. 「News Watch」はヘッダーにあるので二重にいらない
4. スコアリングボタンはデータソースと同じ行にするのも選択肢

いずれも実装上の具体的な欠陥として再現できた。以下、診断→変更内容の順。

## 診断

### 1. ヘッダーに `ml-auto` が2つあり、ハンバーガーが右端に着かない（バグ）

`app-header.tsx:10-18` の flex コンテナに、`ml-auto` を持つ子が**2つ**ある:

| 要素                     | 場所                                                      |
| ------------------------ | --------------------------------------------------------- |
| モバイルのメニューボタン | `app-nav.tsx:46` の `<div className="md:hidden ml-auto">` |
| テーマトグルのラッパー   | `app-header.tsx:15` の `<div className="ml-auto ...">`    |

flexbox は `margin-left: auto` を持つ要素が複数あると**余白をそれらの間で分配する**。結果、モバイルでは

```
[News Watch] ←余白1/2→ [☰] ←余白1/2→ [🌓]
```

となり、ハンバーガーが右端でも左端でもない中途半端な位置に浮く。これが「配置がモバイル最適化されていない」の正体。

### 2. タップ領域が 32px しかない

`src/components/ui/button.tsx:29` — `size: { icon: "size-8" }` = **32×32px**。メニューボタンとテーマトグルの両方がこのサイズ。iOS HIG の 44×44、Android の 48×48 いずれも下回っている。

### 3. 3項目のために Sheet を使っている

ナビ項目は ニュース / ブックマーク / DB の**3つだけ**。それを開閉するために Radix `Sheet`（オーバーレイ + `useState` + 約40行）を使っており、どのページへ行くにも必ず2タップかかる。375px で実測すると、ロゴを含めても

```
「News Watch」bold ≈ 90px + アイコン3つ 108px + テーマトグル 36px + gap 24px = 258px / 343px
```

**横並びで収まる**。Sheet を持つ必然性がない。

### 4. 「データソース」ツールバーの表記重複と横溢れ

`fetch-button.tsx:130-136`:

```tsx
<SourceFilter value={selectedSource} onSourceChange={handleSourceChangeWithRouter} />
<span className="text-sm text-muted-foreground">
  {SOURCES.find((s) => s.id === selectedSource)?.name} ソース
</span>
<FetchAction isLoading={apiInFlight} onFetch={handleFetch} className="ml-auto" />
```

`<select>` が既に選択中のソース名（例: `Zenn`）を表示しているのに、その右で `Zenn ソース` と**同じ情報を再掲**している。375px（PageShell の `px-4` を引いて実効 343px）での幅内訳:

| 要素                                     | 実測幅                                  |
| ---------------------------------------- | --------------------------------------- |
| 「データソース」label (`text-xs`)        | ~72px                                   |
| `<select>`                               | ~76px                                   |
| **「Zenn ソース」span（重複）**          | **~98px**                               |
| 「ニュースを取得してスコアリング」ボタン | **~242px**                              |
| gap × 3                                  | 36px                                    |
| **合計**                                 | **524px** — 343px に対し **181px 超過** |

コンテナが `flex-wrap` なので**折り返して2〜3行になる**。ユーザーの「スコアリングボタンはデータソースと同じ行に」はこの折り返しを指している。重複 span を消しても 414px でまだ収まらない — **ボタンのラベル 15文字が主犯**。

### 5. 「News Watch」が3箇所に出ている

| #   | 場所                                                       |
| --- | ---------------------------------------------------------- |
| 1   | `app-header.tsx:11-13` — ヘッダーのロゴ                    |
| 2   | `page.tsx:19` — `<PageShell title="News Watch">` の `<h1>` |
| 3   | `app-nav.tsx:56-58` — Sheet 内のロゴ                       |

ヘッダーは `sticky` で常時見えているので、直下に同じ文字列の `<h1>`（`text-2xl`）が再掲されるのは冗長かつ、モバイルの縦を約 56px 無駄にしている。

### 6. モバイルの縦がシェルに食われている

375px でファーストビューに記事が現れるまで、上から `ヘッダー 56px` → `h1「News Watch」約56px` → `ソースツールバー 2〜3行 約120px` → `h2「スコアリング済み記事 (100件)」約48px` = **約280px**。iPhone SE の可視高 667px の **42%** がシェル。

## 変更内容

### A. `AppNav` を分割し、モバイルはアイコン3つの横並びに — `src/components/layout/app-nav.tsx`

`Sheet` / `SheetContent` / `SheetTrigger` / `SheetTitle` / `Menu` アイコン / `useState` を全て撤去し、**Sheet 依存をゼロにする**（これで診断5の3箇所目「News Watch」も自然に消える）。`navItems` 配列は現状のまま流用。

エクスポートを2つに分ける:

- `AppNav` — 既存のデスクトップ用ピルナビ（`hidden md:flex`）。**中身は無変更**
- `AppNavMobile` — 新規。`md:hidden` でアイコンのみのリンクを3つ並べる

```tsx
export function AppNavMobile() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 md:hidden" aria-label="メインナビゲーション">
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={item.prefetch ?? true}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex size-11 items-center justify-center rounded-full transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="h-5 w-5" />
          </Link>
        );
      })}
    </nav>
  );
}
```

- `size-11` = **44px** でタップ領域を HIG 準拠に（診断2）
- ラベルはアイコンのみになるので `aria-label={item.label}` が必須。`aria-current="page"` と `bg-accent` は現在地の手がかりとして維持
- `/admin/db` の `prefetch: false` は**必ず維持** — 外すと Basic 認証ダイアログが出る既知バグが再発する（コミット `db54497`、[[bug_menu_auth_dialog]]）

### B. ヘッダーの `ml-auto` 二重を解消 — `src/components/layout/app-header.tsx`

スペーサーを**1つだけ**にし、要素の順序を「ロゴ → (余白) → ナビ → テーマトグル」に固定する:

```tsx
<div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
  <Link href="/" className="font-bold tracking-tight text-foreground">
    News Watch
  </Link>
  <AppNav />
  <div className="ml-auto flex items-center gap-1">
    <AppNavMobile />
    <ThemeToggle />
  </div>
</div>
```

`ml-auto` はこの1箇所のみ。デスクトップでは `AppNavMobile` が `md:hidden` で消え、`AppNav` がロゴ直後に並ぶ現状の見た目を維持する。

`ThemeToggle` も `size="icon"`（32px）なら `size-11` 相当に揃える。`src/components/layout/theme-toggle.tsx` を確認し、`className="size-11"` の付与、または `size="icon-lg"` への変更で対応する。

### C. ソースツールバーの重複 span を削除 — `src/app/fetch-button.tsx`

`fetch-button.tsx:132-134` の

```tsx
<span className="text-sm text-muted-foreground">
  {SOURCES.find((s) => s.id === selectedSource)?.name} ソース
</span>
```

を削除。`<select>` が同じ情報を表示しているため純粋な重複。**削除後 `SOURCES` の import（`fetch-button.tsx:9`）が未使用になるので併せて外す**（`pnpm lint` が拾う）。

行を折り返さないよう `flex-wrap` を外す:

```diff
- <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
+ <div className="flex items-center gap-2 border-b border-border pb-3 sm:gap-3 sm:pb-4">
```

### D. 取得ボタンのラベルをレスポンシブに — `src/components/news/fetch-action.tsx`

重複 span を消しても 414px で 343px に収まらない。主因は 15文字のラベルなので、モバイルだけ短縮する:

```tsx
{
  isRefreshing ? (
    <>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="sm:hidden">取得中...</span>
      <span className="hidden sm:inline">取得・スコアリング中...</span>
    </>
  ) : (
    <>
      <RefreshCw className="h-4 w-4 sm:hidden" />
      <span className="sm:hidden">取得</span>
      <span className="hidden sm:inline">ニュースを取得してスコアリング</span>
    </>
  );
}
```

`RefreshCw` は `lucide-react` から追加 import。`py-2` は `min-h-11` に変えてタップ領域を 44px に揃える。

これで 375px のツールバーは:

| 要素                  | 幅                               |
| --------------------- | -------------------------------- |
| 「データソース」label | 72px                             |
| `<select>`            | 76px                             |
| 「⟳ 取得」ボタン      | ~84px                            |
| gap × 2               | 16px                             |
| **合計**              | **248px / 343px** ✅ 1行に収まる |

`sm:` 以上では従来の長いラベルが出るので、PC の情報量は落ちない。

### E. `/` の `<h1>` 重複を解消 — `src/app/page.tsx` + `src/components/news/news-section.tsx`

`page.tsx:19` から `title` を落とす:

```diff
- <PageShell title="News Watch">
+ <PageShell>
```

`PageShell` は `title`/`actions` が無ければ見出しブロック自体を描画しない（`page-shell.tsx:29`）ので、追加の変更は不要。

ただしこのままだとページに `<h1>` が無くなるため、`news-section.tsx:38` の `<h2>` を `<h1>` に昇格させる:

```diff
- <h2 className="text-xl font-semibold">
+ <h1 className="text-xl font-semibold">
```

`NewsSection` は `/` でしか使われていないので昇格して問題ない（`bookmarks/page.tsx` は `ArticleList` を直接使い、`PageShell title="ブックマーク"` が `<h1>` を出している）。`tests/components/NewsSection.test.tsx` は `getByText("スコアリング済み記事")` でしか検証しておらず見出しレベルを見ていないため、**テスト改修は不要**。

これでモバイルの縦を約 56px 回収し、ページの主題が「News Watch」（サイト名の再掲）から「スコアリング済み記事」（実際の内容）に変わる。

### F. `mb-4` の重複余白を削る — `news-section.tsx:37`

`<div className="mb-4 flex items-center justify-between">` の `mb-4` は、親 `<div className="space-y-3">` の 12px と重なって見出し下に 16px 空けている。ツールバーの `pb-3` と合わせて `mb-2 sm:mb-4` に緩める。

## 変更後の縦の回収（375px / iPhone SE 可視高 667px）

| 領域                           | 変更前            | 変更後            |
| ------------------------------ | ----------------- | ----------------- |
| ヘッダー                       | 56px              | 56px              |
| `<h1>News Watch`               | 56px              | **0px**           |
| ソースツールバー               | 約120px（2〜3行） | **約60px（1行）** |
| 「スコアリング済み記事」見出し | 48px              | 44px              |
| **記事到達までの合計**         | **約280px (42%)** | **約160px (24%)** |

## 検討して見送った案

| 案                                            | 見送り理由                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 下部固定タブバー                              | 記事リストの縦を 56px 常時占領する。プラン14/15 で稼いだ表示面積とトレードオフになり、モバイル最優先の方針に合わない                |
| Sheet を維持して配置とタップ領域だけ直す      | 3項目のために全ページ遷移が2タップのまま残る。Sheet 撤去で `Sheet` 依存・`useState`・重複ロゴが同時に消える方が得                   |
| 「データソース」label も `sr-only` にする     | 短縮ボタン採用後は 248/343px で余裕があり、隠す必要がない。ラベル無しの `<select>` は何のピッカーか不明瞭になる                     |
| `PageShell` の `title` を「ニュース」等に変更 | 見出しが1行増える点は変わらない。`NewsSection` の見出しが既にページの主題を表しているので、そちらを `<h1>` にする方が構造的に正しい |
| ヘッダーのロゴを `<h1>` にする                | ヘッダーは全ページ共通なので、`/bookmarks` や `/admin/db` でも `<h1>` が「News Watch」になり見出し構造が崩れる                      |

## 検証

1. `pnpm test` — 特に `NewsSection.test.tsx`（`getByText` のみなので h2→h1 でも通る）。`AppNav` / `AppHeader` のテストがあれば Sheet 前提のアサーションが落ちるので確認・修正する
2. `pnpm lint` — `SOURCES` の未使用 import が残っていないこと、Server/Client 境界検査が通ること
3. `pnpm type-check`
4. `pnpm dev` → DevTools のデバイスツールバーで確認:
   - **375px** — ヘッダーが `[News Watch] …余白… [📰][🔖][🗄][🌓]` の順で、アイコン群が**右端に密着**していること（`ml-auto` 二重の解消確認）
   - アイコンを1つずつタップして 44px の当たり判定があること、`/admin/db` タップで **Basic 認証ダイアログが出ないこと**（`prefetch: false` の維持確認 — 回帰しやすい）
   - ソースツールバーが**1行に収まる**こと。ソースを切り替えて select の表示が変わり、右側に「〜ソース」の再掲が無いこと
   - `<h1>` が「スコアリング済み記事 (N件)」1つだけであること（DevTools の Accessibility ツリー、または `document.querySelectorAll("h1")` が長さ1）
   - **768px 以上** — ピルナビ + 長いボタンラベルが従来どおり表示され、記事カードの見た目がプラン15から変わっていないこと
   - `/bookmarks` と `/admin/db` でもヘッダーの現在地ハイライト（`aria-current`）が正しく移ること
5. `pnpm build`

## 実行結果（2026-08-09）

### 実装内容

1. **`app-nav.tsx`** — Sheet 依存を完全撤去（`Sheet` / `SheetContent` / `SheetTrigger` / `SheetTitle` / `Menu` / `useState` を削除）。`AppNav`（デスクトップ用ピルナビ、`hidden md:flex`）と新規 `AppNavMobile`（`md:hidden` のアイコン3つ、`size-11` = 44px タップ領域、`aria-label` + `aria-current`）に分割。`/admin/db` の `prefetch: false` は維持（Basic 認証ダイアログ回帰防止）。
2. **`app-header.tsx`** — `ml-auto` 二重を解消し、`AppNavMobile` + `ThemeToggle` を単一の `ml-auto` コンテナに集約。`gap-2 px-4 sm:gap-4 sm:px-6` に調整。
3. **`fetch-button.tsx`** — 重複する「〜ソース」span を削除し、未使用になった `SOURCES` import を除去。コンテナを `flex items-center gap-2 pb-3 sm:gap-3 sm:pb-4` に（`flex-wrap` を外して1行固定）。
4. **`fetch-action.tsx`** — ボタンラベルをレスポンシブ化（モバイル「⟳ 取得」/「取得中...」、`sm:` 以上は従来の長いラベル）。`RefreshCw` を追加 import。`py-2` → `min-h-11` でタップ領域 44px に。**`aria-label` を付与して accessible name を固定**（happy-dom では Tailwind CSS が効かず両 span が連結されるため、テスト無改修の必須条件）。
5. **`page.tsx`** — `<PageShell title="News Watch">` → `<PageShell>`（重複 h1 を撤去）。
6. **`news-section.tsx`** — `<h2>` → `<h1>` に昇格（ページの主題を「スコアリング済み記事」に）。`mb-4` → `mb-2 sm:mb-4`。
7. **`theme-toggle.tsx`** — `h-9 w-9` → `size-11`（44px に統一）。
8. **`spec.md`** — コンポーネントツリーの `MobileNav (Sheet)` → `AppNavMobile (icon-only links, md:hidden)`、`NewsSection` に `h1 heading` を追記。

### 検証結果

| チェック                                                                                                                         | 結果                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `pnpm run lint:fast`                                                                                                             | ✅ error 0（warning は既存のもののみ） |
| `pnpm exec tsgo --noEmit`                                                                                                        | ✅ パス                                |
| 対象8テスト（AppNav / ThemeToggle / FetchButton / NewsSection / ArticleCard / ScorePopover / ArticleList / FavoriteArticleList） | ✅ 37 passed（**無改修**）             |
| `pnpm exec vitest run`                                                                                                           | ✅ 336 passed / 2 skipped（65 files）  |
| `pnpm build`                                                                                                                     | ✅ パス                                |

`FetchButton.test.tsx` は `getByRole("button", { name: "ニュースを取得してスコアリング" })` 等で accessible name を検証しているため、レスポンシブラベル実装には `aria-label` による名前固定が必須だった（happy-dom では CSS が効かず両 span が連結されるため）。テストファイルは一切変更していない。

### コミット・プッシュ

- コミット: `feat(ui): ヘッダーとツールバーのモバイル最適化 — Sheet撤去・ml-auto二重解消・重複表記排除`
- 対象: `openspec/specs/news-watch/spec.md` / `src/app/fetch-button.tsx` / `src/app/page.tsx` / `src/components/layout/app-header.tsx` / `src/components/layout/app-nav.tsx` / `src/components/layout/theme-toggle.tsx` / `src/components/news/fetch-action.tsx` / `src/components/news/news-section.tsx` / `shared-plan/16-mobile-header-toolbar.md`
- pre-commit フック（lint-staged）通過
- pre-push フック全通過:
  - spec 参照検証 ✅
  - スキーマ整合性 ✅
  - カバレッジ Tier 検証 ✅
  - 本番スキーマ整合 ✅
- プッシュ: `master -> origin/master`
