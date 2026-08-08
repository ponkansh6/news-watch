# 02. デザインシステム基盤

すべての画面刷新はここから始める。トークンと primitive が揃う前に画面を触ると、
また別種のユーティリティ文字列が増えるだけになる。

## 2.1 shadcn/ui の導入

### 導入コマンド

```bash
# AGENTS.md より npx 禁止 → pnpm dlx を使う
pnpm dlx shadcn@latest init -d --base radix
```

- `-d` は必須。`-y` だけでは primitive ライブラリ選択のプロンプトが残る
- `--base radix`（既定）を明示。Base UI は選ばない
- `style` は `new-york`、`baseColor` は `zinc` を想定

### 生成/変更されるもの

| パス                  | 内容                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| `components.json`     | 新規。alias を後述の通り調整する                                                 |
| `src/lib/utils.ts`    | 新規。`cn()`（clsx + tailwind-merge）                                            |
| `src/app/globals.css` | **上書きされる** — §2.2 の手当てが必須                                           |
| `package.json`        | `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` |

`components.json` の alias は既存の `@/*` → `./src/*`（`tsconfig.json:19-21`）に合わせる:

```json
{
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

### 初期導入する primitive

```bash
pnpm dlx shadcn@latest add button card badge skeleton separator \
  tooltip popover dropdown-menu sheet dialog alert-dialog \
  sonner label select tabs scroll-area
```

| primitive             | 置き換える現状の実装                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| `button`              | `fetch-button.tsx:186`, `analyze-button.tsx:60`, `article-list.tsx:158` の 3 種類 |
| `card`                | `article-list.tsx:173`, `bookmarks/page.tsx:32`, `admin/db/page.tsx:44`           |
| `badge`               | ScoreBadge / キーワードチップ / テーマチップ                                      |
| `skeleton`            | `article-list.tsx:237-267` の手書き Skeleton                                      |
| `tooltip` + `popover` | `article-list.tsx:49` の `title` 属性                                             |
| `sonner`              | `article-list.tsx:145-168` の手書き固定トースト                                   |
| `sheet`               | モバイルナビ / モバイルフィルタ                                                   |
| `alert-dialog`        | 破壊的操作の確認（お気に入りは現状維持のため、適用先は実装時に判断）              |
| `label` + `select`    | `fetch-button.tsx:168-178` のラベルなし `<select>`                                |

> ⚠️ **`select` は要検討**: Radix Select は happy-dom 環境でポインタイベント関連の
> ポリフィルを要求し、既存の `tests/components/FetchButton.test.tsx:105`
> （`getByRole("combobox") as HTMLSelectElement` + `fireEvent.change`）が壊れる。
> 詳細と代替案は [07-roadmap.md §7.3](./07-roadmap.md) を参照。

## 2.2 `globals.css` の再構築

`shadcn init` は `globals.css` を上書きし、**フォント宣言を壊す**（skill が明示している
既知の gotcha であり、本プロジェクトは既にこの壊れ方をしている → [01 §A](./01-current-state.md)）。
init 後に必ず以下の形へ直す。

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;

  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);

  /* ── アプリ固有トークン（News Watch のドメイン語彙）── */
  --score-high: oklch(0.65 0.15 155); /* >= 8 */
  --score-mid: oklch(0.72 0.15 75); /* 5..7 */
  --score-low: oklch(0.62 0.19 25); /* < 5  */
  --score-none: var(--muted-foreground); /* 未スコア */
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  /* … 以下 shadcn の dark 既定に準拠 … */

  --score-high: oklch(0.72 0.16 155);
  --score-mid: oklch(0.8 0.15 75);
  --score-low: oklch(0.7 0.19 25);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* … shadcn が生成する全マッピング … */

  --color-score-high: var(--score-high);
  --color-score-mid: var(--score-mid);
  --color-score-low: var(--score-low);

  /* ⚠️ フォントは「リテラル名」で書く。var() は @theme inline で解決されない */
  --font-sans:
    "Geist", "Geist Fallback", "Hiragino Sans", "Noto Sans JP", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", "Geist Mono Fallback", ui-monospace, monospace;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

### 必須の削除

`globals.css:22-26` の以下は**必ず消す**。これが Geist を潰している張本人:

```css
body {
  font-family: Arial, Helvetica, sans-serif;
} /* ← 削除 */
```

同じく `@media (prefers-color-scheme: dark)` ブロック（`:15-20`）も削除し、
`.dark` クラス方式へ移行する（§2.4）。

## 2.3 日本語タイポグラフィ

Geist は**日本語グリフを持たない**。現状の日本語は OS フォールバック任せで環境依存。

### 方針

`layout.tsx` に Noto Sans JP を追加し、Geist の直後に置く:

```tsx
import { Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "700"],
});
```

> `next/font/google` は Noto Sans JP に対して自動サブセット化を行う。
> それでも初回転送量は無視できないため、**weight は 3 種に絞る**。
> 計測して重いようなら `preload: false` + 既定を OS フォント（`Hiragino Sans` /
> `Yu Gothic` / `Noto Sans CJK JP`）に切り替える判断も残す。

### 日本語向けの調整

| 対象                  | 値                           | 理由                                       |
| --------------------- | ---------------------------- | ------------------------------------------ |
| 本文 line-height      | `1.75`（`leading-relaxed`）  | 和文は英文より行間が要る                   |
| 見出し letter-spacing | `0`（`tracking-normal`）     | 現状の `tracking-tight` は和文で字が潰れる |
| 記事タイトル          | `text-pretty` + 2 行クランプ | 日本語の折り返し品質                       |
| 数値/日時/ID          | `font-mono` + `tabular-nums` | スコアや件数が横にずれない                 |

`page.tsx:13` と `bookmarks/page.tsx:16` の `tracking-tight` は和文見出しには不適なので外す。

## 2.4 ダークモード（手動切替 + OS 追従）

### 実装

`next-themes` を採用する（shadcn の標準経路、`suppressHydrationWarning` まで含めて枯れている）:

```bash
pnpm add next-themes
```

```tsx
// src/app/layout.tsx
<html
  lang="ja"
  suppressHydrationWarning
  className={`${geistSans.variable} ${geistMono.variable} ${notoSansJP.variable} h-full antialiased`}
>
  <body className="min-h-full flex flex-col">
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <RefreshProvider>{children}</RefreshProvider>
    </ThemeProvider>
  </body>
</html>
```

- `defaultTheme="system"` — 初回は OS 設定に従う
- `attribute="class"` — `.dark` を `<html>` に付与（`@custom-variant dark` と対応）
- `disableTransitionOnChange` — 切替時の色遷移フラッシュを防ぐ
- `suppressHydrationWarning` — インラインスクリプトによるクラス先付けの副作用を抑える

### 切替 UI

共通ヘッダー（[03-app-shell.md](./03-app-shell.md)）に `DropdownMenu` ベースの
テーマ切替を置く。ライト / ダーク / システム の 3 択。アイコンは `lucide-react` の
`Sun` / `Moon` / `Monitor`。

### 移行ルール

**トークン以外の色クラスを新規に書かない。** 既存箇所の対応表:

| Before                            | After                                    |
| --------------------------------- | ---------------------------------------- |
| `bg-white`                        | `bg-card`                                |
| `bg-neutral-50`                   | `bg-muted` / `bg-background`             |
| `text-neutral-900`                | `text-foreground`                        |
| `text-neutral-500` / `-400`       | `text-muted-foreground`                  |
| `border-neutral-200`              | `border-border`                          |
| `text-red-*` / `bg-red-50`        | `text-destructive` / `bg-destructive/10` |
| `bg-emerald-100 text-emerald-700` | `text-score-high` + `bg-score-high/12`   |

### 検証

`.dark` を強制した状態で全画面を目視する。以下は特に見落としやすい:

- `article-list.tsx` のキーワードチップ 8 色（`:58-67`）— ダークで背景 `*-50` は破綻する
- `admin/db/[table]/components/DataTable.tsx` の縞模様/ホバー
- トーストの成功/失敗色

## 2.5 密度とスペーシング

1 画面 1 密度で統一する。News Watch は**リスト密度が価値**なので `compact` 系を基準にする。

| 用途             | 値                                           |
| ---------------- | -------------------------------------------- |
| ページ padding   | `px-4 py-6 sm:px-6 lg:px-8`                  |
| コンテンツ最大幅 | `max-w-4xl`（リスト） / `max-w-7xl`（admin） |
| カード padding   | `p-4`                                        |
| カード間 gap     | `gap-2`（現状 `space-y-3` から詰める）       |
| セクション間     | `space-y-8`（現状 `mb-12` から詰める）       |
| 角丸             | `--radius: 0.625rem` に統一                  |

`page.tsx:16,20` の `mb-12` は縦に間延びしている。`space-y-8` へ。

## 2.6 ディレクトリ構成

```
src/
├── app/                       # ルートファイルのみ（page/layout/loading/error）
├── components/
│   ├── ui/                    # shadcn 生成物（手を入れるのは variant 追加時のみ）
│   ├── layout/
│   │   ├── app-header.tsx
│   │   ├── app-nav.tsx
│   │   └── theme-toggle.tsx
│   ├── article/
│   │   ├── article-card.tsx
│   │   ├── article-list.tsx
│   │   ├── article-skeleton.tsx
│   │   └── score-badge.tsx
│   └── news/
│       ├── source-filter.tsx
│       ├── fetch-action.tsx
│       └── news-section.tsx
└── lib/
    ├── utils.ts               # cn()
    └── ui/
        └── score.ts           # スコア → トークン/ラベルの写像（純関数、テスト容易）
```

`src/lib/ui/score.ts` にスコアの分類ロジックを純関数として切り出すことで、
Tier 1 相当のテストが書け、Tier 5 のコンポーネントテスト負荷を下げられる。

> ⚠️ ファイル移動は `scripts/check-coverage-tiers.mjs:74-82` の Tier 5 パターンを
> 壊す。移動と同時にスクリプトと `spec.md §7.1` を更新すること。
> 詳細 → [07-roadmap.md](./07-roadmap.md)
