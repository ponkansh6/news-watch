# Phase 3 — ツールバーと更新体験

> 開始: 2026-08-08（R1～R5 完了後）
> 対象: `src/app/fetch-button.tsx` / `src/components/news/` / Context 構造

## 目的

現状の「ソース選択 + 取得ボタン」コンポーネント（250 行）を機能ごとに分割し、
更新中の体験を改善（スケルトンに置換 → 既存記事の減光表示）。

---

## P3 タスク分割

### P3-1 — Cookie 駆動のソース選択（URL 単一情報源化）

**対象**: `src/app/page.tsx` / `fetch-button.tsx:24-47`

| #   | 作業                                                                          | 根拠       |
| --- | ----------------------------------------------------------------------------- | ---------- |
| 1   | `fetch-button.tsx` から `selectedSource` の localStorage 初期化を削除         | 04 §4.3    |
| 2   | `src/app/page.tsx` で `cookies()` → `searchParams.source ?? cookie ?? "zenn"` | 04 §4.3    |
| 3   | ソース変更時、Server Action で Cookie を書き、`router.push(?source=...)`      | URL 駆動化 |
| 4   | マウント時 `router.replace()` を削除（ちらつき解消）                          | 04 §4.3    |

**副作用**:

- FetchButton.test.tsx の `:40-47` の router.replace テストが不要に（削除 or スキップ化）

---

### P3-2 — `fetch-button.tsx` を 3 コンポーネントに分割

**新構成**:

```
src/components/news/
├── source-filter.tsx      # ソース選択（ネイティブ <select>）
├── fetch-action.tsx       # 取得実行 + 進捗表示
└── fetch-result.tsx       # 結果サマリ（折りたたみ）
```

**既存機能の移行**:

| 既存コード                 | 移行先        | 変更内容                                          |
| -------------------------- | ------------- | ------------------------------------------------- |
| `fetch-button.tsx:24-37`   | source-filter | localStorage 削除、URL 変更を Server Action に    |
| `fetch-button.tsx:77-88`   | source-filter | `handleSourceChange` を Server Action に          |
| `fetch-button.tsx:90-151`  | fetch-action  | `handleFetch` のロジック。UI は進捗インジケータに |
| `fetch-button.tsx:195-239` | fetch-result  | 結果表示・詳細の折りたたみ                        |

**レイアウト**（計画 04 §4.3）:

```tsx
<div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
  <SourceFilter value={selectedSource} /> {/* 左 */}
  <span className="text-sm text-muted-foreground">{count}件</span>
  <FetchAction source={selectedSource} className="ml-auto" /> {/* 右 */}
</div>
```

---

### P3-3 — 更新中の体験改善（スケルトン → 減光）

**対象**: `src/components/news/news-section.tsx:48-49` / `fetch-button.tsx:51-57`

| #   | 作業                                                                     | 根拠           |
| --- | ------------------------------------------------------------------------ | -------------- |
| 1   | `isRefreshing` 中もリストを表示（消さない）                              | 04 §4.4        |
| 2   | リストに `aria-busy="true"` + `opacity-60 pointer-events-none` で減光    | セマンティクス |
| 3   | ツールバー右に進捗インジケータ（`Loader2` 回転 + テキスト）              | 04 §4.4        |
| 4   | 新着記事が入ったら、先頭に `animate-in fade-in slide-in-from-top` で強調 | 04 §4.4        |

**タイマー統合**（04 §4.4）:

| 経路           | タイミング                        | タイムアウト | 実装                                       |
| -------------- | --------------------------------- | ------------ | ------------------------------------------ |
| ID 差分        | 新着記事が届いた時                | —            | `news-section.tsx` の `useEffect`          |
| フォールバック | API 成功後、新着がない（saved=0） | 5 秒         | `fetch-action.tsx` の `refreshFallbackRef` |
| セーフティ     | 上記どちらも発火しない            | 30 秒        | `fetch-action.tsx` の `isRefreshing` 監視  |

---

### P3-4 — `isFiltering` の `useTransition` 置換

**対象**: `src/app/refresh-context.tsx` / ソース変更フロー

| #   | 作業                                                                            | 根拠                       |
| --- | ------------------------------------------------------------------------------- | -------------------------- |
| 1   | `source-filter.tsx` で Server Action 実行時に `useTransition` の pending を監視 | 04 §4.3                    |
| 2   | ツールバー右に pending 中の「フィルタリング中...」インジケータ                  | 既存 FetchButton と同じ UI |
| 3   | RefreshContext から `isFiltering` / `setFiltering` を削除可能か検討             | コンテキスト縮小           |

**判断**:

- `isRefreshing` だけ残すか、Context 自体を削除するかは、他のコンポーネントの依存関係による

---

### P3-5 — 空状態の designed empty state 化

**対象**: `src/components/news/news-section.tsx:51-56`

**現状**:

```tsx
<div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center text-neutral-400">
  <p className="mb-2 text-lg">まだ記事がありません</p>
  <p className="text-sm">「ニュースを取得」ボタン...</p>
</div>
```

**新形式**（04 §4.5）:

```tsx
<Card className="p-12 text-center">
  <Newspaper className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
  <h3 className="text-lg font-semibold">まだ記事がありません</h3>
  <p className="text-sm text-muted-foreground mt-2">{source}の記事がまだ取得されていません</p>
  <Button className="mt-6">ニュースを取得</Button> {/* 一次アクション */}
</Card>
```

---

## 実行順序とコミット計画

```
P3-1 (Cookie 駆動化)
  ↓
P3-2 (fetch-button 分割)
  ↓
P3-3 (スケルトン → 減光)
  ↓
P3-4 (useTransition)
  ↓
P3-5 (空状態)
  ↓
テスト修正・検証
```

各 P3-N は独立したコミットが望ましい（順序依存なし）。

---

## テスト影響

（FetchButton.test.tsx に大きな変更）

| テスト                                     | 影響                                         | 対応                            |
| ------------------------------------------ | -------------------------------------------- | ------------------------------- |
| `FetchButton.test.tsx:94-117`              | ソース選択の `fireEvent.change` テスト       | Server Action テストへ置換      |
| `FetchButton.test.tsx:316,323,396,405,419` | 「(N件)」「(更新中...)」の見出しサフィックス | 新構成に合わせて更新            |
| `NewsSection.test.tsx`                     | 空状態の文言・構造                           | designed empty state に合わせる |
| `display-after-scoring.test.ts`            | 更新中の DOM 構造（Skeleton → 減光）         | isRefreshing フロー確認         |

---

## 完了条件

- ✅ 初回描画でソースがちらつかない（マウント時 `router.replace()` 削除確認）
- ✅ 更新中も既存記事が読める（opacity-60 + pointer-events-none）
- ✅ 新着記事が先頭に slide-in で強調表示
- ✅ タイマー 3 系統が 1 本に統合（セーフティ 30 秒）
- ✅ 全テスト通過 + カバレッジ維持（Tier 5: >80%）
- ✅ 空状態が designed（Card + アイコン + CTA）
