# 03. アプリシェルとナビゲーション

## 3.1 現状の問題

シェルが 3 箇所で個別に実装されている:

| 画面         | シェル実装                                                                   |
| ------------ | ---------------------------------------------------------------------------- |
| `/`          | `page.tsx:11-14` — `main.mx-auto.max-w-4xl` + `<h1>` 直書き                  |
| `/bookmarks` | `bookmarks/page.tsx:13-14` — `div.min-h-screen.bg-neutral-50` を追加で被せる |
| `/admin/db`  | `admin/db/layout.tsx:7-21` — 独自ヘッダー（`<a>` タグ、`Link` ですらない）   |

`/` から `/bookmarks` へのリンクは**どこにも存在しない**。URL 直打ちでしか行けない。

## 3.2 共通シェルの設計

### 構成

```
src/components/layout/
├── app-header.tsx     # sticky ヘッダー（ロゴ + ナビ + テーマ切替）
├── app-nav.tsx        # デスクトップ横並び / モバイル Sheet
└── theme-toggle.tsx   # ライト/ダーク/システム
```

`src/app/layout.tsx` に `<AppHeader />` を置き、全ルートで共有する。
`bookmarks/page.tsx:13` の `min-h-screen` ラッパーと `admin/db/layout.tsx` の
ヘッダーは削除する。

### AppHeader

```tsx
<header
  className="sticky top-0 z-40 w-full border-b border-border
                   bg-background/80 backdrop-blur-sm
                   supports-[backdrop-filter]:bg-background/60"
>
  <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
    <Link href="/" className="font-semibold tracking-tight">
      News Watch
    </Link>
    <AppNav className="hidden md:flex" />
    <div className="ml-auto flex items-center gap-1">
      <ThemeToggle />
      <MobileNav className="md:hidden" />
    </div>
  </div>
</header>
```

- `sticky` — 長いリストを読んでいる最中もナビへ戻れる
- 高さは `h-14` 固定。可変にしない（レイアウトシフトの元）
- `backdrop-blur` は `supports-[]` でガードし、非対応環境では不透明背景

### ナビゲーション項目

| ラベル       | href         | 表示条件                                           |
| ------------ | ------------ | -------------------------------------------------- |
| ニュース     | `/`          | 常時                                               |
| ブックマーク | `/bookmarks` | 常時。件数バッジを付ける                           |
| DB           | `/admin/db`  | 常時（Basic 認証で保護済み → `src/middleware.ts`） |

アクティブ状態は `usePathname()` で判定し、`aria-current="page"` を付ける。
下線ではなく `bg-accent text-accent-foreground` のピル形状にする（`h-14` 内で収まる）。

モバイル（`< md`）は `Sheet` を右から出す。`Button variant="ghost" size="icon"` +
`lucide-react` の `Menu`。

### ブックマーク件数バッジ

`getFavoriteArticlesCached()` は既にキャッシュ経由（`bookmarks/page.tsx:8`）。
ヘッダーは全ページで描画されるため、**件数取得はサーバーコンポーネントに閉じ、
Suspense で包む**。取得失敗やコールドスタート時にヘッダー全体が待たされないようにする:

```tsx
<Suspense fallback={null}>
  <BookmarkCountBadge />
</Suspense>
```

## 3.3 ページシェルの統一

```tsx
// src/components/layout/page-shell.tsx
export function PageShell({ title, description, actions, children, width = "default" }) {
  return (
    <main
      className={cn(
        "mx-auto w-full px-4 py-6 sm:px-6 lg:px-8",
        width === "wide" ? "max-w-7xl" : "max-w-4xl",
      )}
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </main>
  );
}
```

これを `/`, `/bookmarks`, `/admin/db`, `/admin/db/[table]` の全てで使う。
見出しレベル・余白・最大幅が一箇所に集約される。

## 3.4 ローディング / エラー境界

### `loading.tsx` の作り直し

現状（[01 §F](./01-current-state.md)）は `page.tsx` の手写しコピーで、
存在しない「最終更新」セクションまで含んでいる。

方針: **loading.tsx は PageShell + Skeleton のみ**にし、実ページと同じ
`PageShell` を使うことで構造の乖離を構造的に不可能にする。

```tsx
export default function Loading() {
  return (
    <PageShell title="News Watch">
      <FetchActionSkeleton />
      <ArticleListSkeleton count={6} />
    </PageShell>
  );
}
```

さらに `page.tsx` 側で `<Suspense>` を使い、FetchAction（クライアント側で即座に
使える）と記事リスト（DB 待ち）をストリーミングで分離する。ボタンが先に触れる。

### 新規に追加するファイル

| パス                            | 役割                                                           |
| ------------------------------- | -------------------------------------------------------------- |
| `src/app/error.tsx`             | ルートのエラー境界。`Alert` + `reset()` ボタン。`"use client"` |
| `src/app/not-found.tsx`         | 404。ホームへの導線                                            |
| `src/app/bookmarks/loading.tsx` | ブックマークの Skeleton                                        |
| `src/app/admin/db/error.tsx`    | DB 接続失敗を admin 内に閉じ込める                             |

`error.tsx` には `digest` を表示しない（本番でのスタック露出を避ける）。
開発時のみ `process.env.NODE_ENV === "development"` で `error.message` を出す。

### グローバルトースト

`article-list.tsx:145-168` の手書き固定トーストは**お気に入りフィードバック専用**であり、
お気に入りは現状維持のため **sonner 化しない**（現状のまま残す）。

`sonner` はお気に入り以外の場面（Phase 4 の `AnalyzeButton` 結果表示など）で導入し、
その際に `<Toaster />` を `layout.tsx` に一度だけ置く。

- お気に入りトーストは現状の `role="alert"` + 5 秒自動消去（`article-list.tsx:82-89`）を維持
- sonner 導入時は `richColors` + `position="top-center"`（現状の `left-1/2 top-4` と同じ位置）

## 3.5 メタデータと静的アセット

### `layout.tsx` のメタデータ拡充

```tsx
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "News Watch", template: "%s — News Watch" },
  description: "AIスコアリングで注目ニュースをキャッチ",
  openGraph: { type: "website", locale: "ja_JP", siteName: "News Watch" },
  robots: { index: false, follow: false }, // 個人用途のため既定で noindex
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};
```

各ページで `title` を設定すれば template が効く（`/bookmarks` → "ブックマーク — News Watch"）。
`admin/db/layout.tsx:1-4` の既存 metadata は `title` だけ残して統合する。

### `public/` の掃除

`next.svg` / `vercel.svg` / `window.svg` / `globe.svg` / `file.svg` は
Next.js テンプレートの残骸。参照がないことを確認して削除する:

```bash
grep -rn "next.svg\|vercel.svg\|window.svg\|globe.svg\|file.svg" src/
```
