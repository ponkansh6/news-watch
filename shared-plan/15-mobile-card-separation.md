# モバイルでの記事カード境界の可視化（区切りの再設計）

## Context

プラン14（コミット `3bc442b`）でモバイルの記事一覧を全幅フィード化し、本文幅は 265px → 351px (93.6%) まで回収できた。一方で **「モバイルでは記事の区切りが分かりづらい」** というフィードバックが出ている。

プラン14は横幅の回収に集中しており、**カード境界の視認性を一度も検証していなかった**。全幅ブリードによって「カード間に背景色が覗く」という従来の最大の境界手がかりが消えたのに、代替の手がかりを 1px のヘアラインだけに任せたのが原因。

## 診断

`src/app/globals.css` のトークンを実測したところ、原因は3つ重なっている。

### 1. 1枚のカードに同じ見た目の水平線が2本ある（最大の原因）

現状 1 記事あたり、**同一の `border` 色・同一の 1px 幅**の線が2本描かれている:

| 線                 | 実装                                                      | 役割                   |
| ------------------ | --------------------------------------------------------- | ---------------------- |
| 本文とメタ行の間   | `article-card.tsx:93` の `<Separator className="my-2" />` | カード**内部**の区切り |
| カードとカードの間 | `article-list.tsx` の `divide-y divide-border`            | カード**境界**         |

見た目が同一なので、どちらが境界かを線自体からは判別できない。さらに内側の線の直下にはメタ行（小さく淡いテキスト）が来るため、**メタ行が「上のカードの一部」ではなく「次のカードの見出し」に見える**グルーピングの誤読が起きる。

### 2. ダークモードで境界線がほぼ見えない

```
--border（dark）: oklch(1 0 0 / 10%)   → --card (0.205) の上で実効 ≈ 0.22
--card  （dark）: oklch(0.205 0 0)
```

明度差わずか約 1.5%。ライトモードでは `--border` 0.922 が白カードの上に乗るので見えるが、**ダークモードでは境界線が事実上存在しない**。

### 3. 「カード間に背景を覗かせる」手が使えない

```
--background（light）: oklch(1 0 0)
--card      （light）: oklch(1 0 0)   ← 完全に同一
```

ライトモードで `--background` と `--card` が同じ純白のため、カード間に隙間を空けて地の色を見せる（`sm:` 以上で効いている手法）は**モバイルでは何も見えない**。これがプラン14でブリードした瞬間に境界の手がかりが消えた直接の理由。

### 4. アクセントバーが縦に連結して見える

`<span className="absolute inset-y-0 left-0 w-[3px]" />` は li の上下端いっぱいまで伸びる。**隣接する記事のティアが同色だと 1 本の連続したストライプに融合**し、境界を消す方向に働いてしまっている。

## 変更内容

### A. カード内の `<Separator>` を撤去 — `src/components/article/article-card.tsx`

`article-card.tsx:92-93` の

```tsx
{
  /* Separator */
}
<Separator className="my-2" />;
```

を削除し、`@/components/ui/separator` の import も外す。**「水平線＝カード境界」を1対1にする**のが今回の設計原則。メタ行は `text-xs` + `text-muted-foreground` + スコアの色付き数値で既に本文と十分に差別化されているので、線による区切りは不要。

代わりにメタ行のラッパーへ上マージンを与える:

```tsx
<div className="mt-2.5 flex items-center gap-1.5 text-xs min-w-0">
```

### B. カード境界を 1px ヘアラインから 8px の色帯へ — `src/components/article/article-list.tsx`

```diff
- className={`-mx-4 divide-y divide-border sm:mx-0 sm:divide-y-0 sm:space-y-3 ${...}`}
+ className={`-mx-4 divide-y-8 divide-muted sm:mx-0 sm:divide-y-0 sm:space-y-3 ${...}`}
```

`divide-y-8` は項目間にのみ 8px の帯を作る（リストの上端・下端には付かない）。色は `--muted` を使う — **ライト/ダークの両方でカード面と差が出る唯一のトークン**:

| モード | `--card`           | `--muted`          | 判定                  |
| ------ | ------------------ | ------------------ | --------------------- |
| light  | `oklch(1 0 0)`     | `oklch(0.97 0 0)`  | 白 vs 薄グレー → 可視 |
| dark   | `oklch(0.205 0 0)` | `oklch(0.269 0 0)` | 可視                  |

`--color-muted` は `globals.css:35` で `@theme inline` に公開済みなので `divide-muted` はそのまま使える。`sm:divide-y-0 sm:space-y-3` はプラン14のまま維持し、**タブレット/PC の見た目は一切変えない**。

### C. 縦の余白を再配分 — `article-card.tsx:72`

```diff
- <article className="px-3 py-3 sm:px-4 sm:py-3.5">
+ <article className="px-3 py-4 sm:px-4 sm:py-3.5">
```

これで近接（ゲシュタルト）の階層が明確になる:

| 間隔                   | 変更前                     | 変更後                     |
| ---------------------- | -------------------------- | -------------------------- |
| タイトル→要約（最密）  | 4px                        | 4px                        |
| 要約→メタ行            | 8px + 線 + 8px             | 10px                       |
| **カード境界（最疎）** | **12 + 1px線 + 12 = 25px** | **16 + 8px帯 + 16 = 40px** |

境界が内部間隔の 4 倍になり、色帯と合わせて二重の手がかりになる。`sm:` の `py-3.5` は据え置き（PCはカード枠があるので変更不要）。

### D. アクセントバーをカードごとに分離 — `article-card.tsx:71`

```diff
- <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", barColor)} />
+ <span aria-hidden className={cn("absolute inset-y-4 left-0 w-1 rounded-r-full sm:inset-y-3", barColor)} />
```

`inset-y-4` で `py-4` と上下を揃えると、バーが**カードごとに独立したピル**になり、同ティアが連続しても融合しない。バー自体が「ここから1件」を示す手がかりとして機能する。3px → `w-1` (4px) で視認性も上げる。`absolute` なので**本文幅は 351px のまま**、プラン14の成果は損なわない。

### E. スケルトンを追随 — `src/components/article/article-skeleton.tsx`

実カードとズレると読み込み→表示でガタつくため、同じ値に合わせる:

- `SkeletonList` の `<ul>`: `divide-y divide-border` → `divide-y-8 divide-muted`
- `SkeletonCard` の `<article>`: `py-3` → `py-4`

`<li role="status">` の構造は維持（`tests/components/NewsSection.test.tsx` が li 数を検証している）。

`src/app/loading.tsx` は既に `SkeletonList` を使っているので追加変更は不要。

## 検討して見送った案

| 案                                                 | 見送り理由                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `divide-border` のまま太さだけ上げる               | ダークモードで `--border` が white/10% のため、太くしても明度差 1.5% のまま。太い「ほぼ見えない帯」になるだけ |
| カード間に `bg-background` の隙間を空ける          | ライトモードで `--background` と `--card` が同一の純白のため何も見えない（診断3）                             |
| モバイルでもカードに `ring` と `rounded-xl` を戻す | 左右に ring 分の余白が必要になり、プラン14で回収した横幅を吐き出す。モバイル最優先の方針に反する              |
| `--card` / `--border` トークン自体を調整           | 影響が admin 画面や他カードにも及ぶ。今回の問題は記事一覧のレイアウト起因なのでローカルに閉じる               |

## 検証

1. `pnpm test` — `ArticleCard.test.tsx` / `ScorePopover.test.tsx` / `NewsSection.test.tsx` が**無改修で通ること**。今回の変更はクラスと DOM 1要素（Separator）の削除のみで、テストはテキスト・role・aria-label しか見ていないため通るはず。落ちた場合は想定外の構造変更が混ざったサイン。
2. `pnpm lint` / `pnpm type-check`
3. `pnpm dev` → DevTools のデバイスツールバーで確認:
   - **375px / ライトモード** — 記事と記事の間にグレーの帯が見え、1件の範囲が一目で分かる
   - **375px / ダークモード（`/` でテーマ切替）** — 帯が見えること。今回の修正の主目的はここ
   - カード内に水平線が1本も無いこと（線＝境界の1対1が成立）
   - 左のティアバーが**カードごとに途切れている**こと。スコアが近い記事を連続させて融合しないか確認
   - **768px 以上** — カード枠・角丸・ring・`space-y-3` の余白がプラン14と完全に同一であること（回帰がないこと）
   - 本文の折り返し位置がプラン14から変わっていないこと（横幅 351px の維持確認）
   - `/bookmarks` も同じ `ArticleList` を使うので同時に確認
4. `pnpm build`

## 実行結果（2026-08-09）

### 実装内容

1. **`article-card.tsx`** — カード内の `<Separator>`（`my-2`）を撤去し、`@/components/ui/separator` の import を削除。「水平線＝カード境界」の1対1を確立。メタ行ラッパーに `mt-2.5` を付与して本文との間隔を確保。`<article>` を `py-4`（モバイル）に変更し、カード境界（16px + 8px帯 + 16px = 40px）を内部間隔の4倍に。アクセントバーを `absolute inset-y-4 left-0 w-1 rounded-r-full sm:inset-y-3` の**カードごとに独立したピル**に変更（同ティア連続でも融合しない）。`absolute` のため本文幅 351px は維持。
2. **`article-list.tsx`** — `<ul>` の `divide-y divide-border` → `divide-y-8 divide-muted`。項目間にのみ 8px の色帯（`--muted`）が入り、ライト/ダーク両方でカード面と差が出る。`sm:divide-y-0 sm:space-y-3` は据え置きで PC 表示は不変。
3. **`article-skeleton.tsx`** — `SkeletonList` の `<ul>` を `divide-y-8 divide-muted` に、`SkeletonCard` の `<article>` を `py-4` に追随（実カードとのズレ防止）。
4. **`openspec/specs/news-watch/spec.md`** — コンポーネントツリーの `ArticleList`（mobile boundary = 8px muted band）と `ArticleCard`（accent tier pill, no internal separator）記述を更新。

### 検証結果

| チェック                                                                                    | 結果                                   |
| ------------------------------------------------------------------------------------------- | -------------------------------------- |
| `pnpm run lint:fast`                                                                        | ✅ error 0（warning は既存のもののみ） |
| `pnpm exec tsgo --noEmit`                                                                   | ✅ パス                                |
| 対象5テスト（ArticleCard / ScorePopover / NewsSection / ArticleList / FavoriteArticleList） | ✅ 23 passed（**無改修**）             |
| `pnpm exec vitest run`                                                                      | ✅ 336 passed / 2 skipped（65 files）  |
| `pnpm build`                                                                                | ✅ パス                                |

設計上の制約どおり、テストファイルは**一切変更せず**に全テストが通過した（クラス文字列と DOM 1要素の削除のみの変更で、テストはテキスト・role・aria-label しか見ていないため）。

### コミット・プッシュ

- コミット: `feat(ui): モバイルでの記事カード境界を可視化 — 内部Separator撤去と8px色帯による区切り再設計`
- 対象: `openspec/specs/news-watch/spec.md` / `src/components/article/article-card.tsx` / `src/components/article/article-list.tsx` / `src/components/article/article-skeleton.tsx` / `shared-plan/15-mobile-card-separation.md`
- pre-commit フック（lint-staged）通過
- pre-push フック全通過:
  - spec 参照検証 ✅
  - スキーマ整合性 ✅
  - カバレッジ Tier 検証 ✅
  - 本番スキーマ整合 ✅
- プッシュ: `master -> origin/master`
