# 12. Vercel 本番エラー是正 — RSC レンダリング中の cookie 書き込み

> 作成日: 2026-08-08
> 前提: [11-09-verification.md](./11-09-verification.md) 完了後の本番障害

## Context

`shared-plan/11-09-verification.md` のプッシュ（`508b269`）後に Vercel 本番で
`GET /` が 500 エラーになることを確認した。Vercel ログ:

```
Error: Cookies can only be modified in a Server Action or Route Handler.
Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options
```

原因: `src/app/page.tsx` の RSC（`Home` コンポーネント）のレンダリング中に
`cookieStore.set()` を呼んでいる（Phase 3 コミット `c0bba6f` で混入）。
Next.js では RSC レンダリング中の cookie 書き込みは禁止され、
Server Action または Route Handler 内でのみ許可される。

## 原因の詳細

- `src/app/page.tsx:31-34`:
  ```ts
  if (selectedSource !== savedSource) {
    await setSourceCookie(selectedSource);
  }
  ```
  これが `GET /`（RSC レンダリング）中に cookie を書き込む。
- ファイル先頭の `"use server"` が全エクスポートを Server Action 化しており、
  ページコンポーネントの扱いとしても推奨外の構成（ビルドは通るがランタイムで問題を招く）。

## 決定（2026-08-08、oracle 判断）

**案B を採用**: レンダリング中の cookie 書き込みを削除し、Server Actions を
専用ファイル `src/app/actions.ts` に分離して `page.tsx` を通常の RSC に戻す。

| 案    | 内容                                                             | 判定                                    |
| ----- | ---------------------------------------------------------------- | --------------------------------------- |
| A     | レンダリング中の書き込み削除のみ（page が Server Action のまま） | ⚠️ 最小修正だが構造的に不健全           |
| **B** | **A + Server Actions を actions.ts に分離**                      | ✅ 採用                                 |
| C     | middleware で cookie 同期                                        | ❌ 過剰・静的アセットの扱いに注意が必要 |

## 実装タスク

### T1 — `src/app/actions.ts` 新規作成

`"use server"` ディレクティブ + `setSourceCookie(source)` / `handleSourceChange(source)`
を page.tsx から移設する。

> `fetch-button.tsx` は `onSourceChange` を props で受け取る実装のため、import 変更は不要。

### T2 — `src/app/page.tsx` 修正

- 先頭の `"use server"` を削除（通常の RSC に戻す）
- `setSourceCookie` / `handleSourceChange` のローカル定義を削除し、`./actions` から import
- レンダリング中の cookie 書き込み（31-34行）を削除
- `cookies()` の読み取り（`.get()`）は維持

### T3 — テスト追加（`tests/app/` 配下）

- `tests/app/actions.test.ts`: `setSourceCookie` が `cookie.set` を呼ぶこと、
  `handleSourceChange` がそれを転送すること
- `tests/app/page.test.tsx`: RSC レンダリング中に `cookie.set` が呼ばれないこと
  （`next/headers` と `@/lib/db` をモック）

### 挙動（回帰なし）

| ユースケース                        | 挙動                                                 |
| ----------------------------------- | ---------------------------------------------------- |
| 初回アクセス（?source なし）        | cookie なし → "zenn"                                 |
| URL で ?source=qiita に直接アクセス | cookie は書かないが表示は qiita（searchParams 優先） |
| UI でソース切替                     | Server Action → cookie 書く → router.push            |
| 次回アクセス（?source なし）        | cookie に保存されたソースを表示                      |

## 検証

各変更後に以下を実行し、すべて PASS すること:

```bash
pnpm exec tsgo --noEmit
pnpm run lint:fast
pnpm exec vitest run
pnpm exec vitest run --coverage && node scripts/check-coverage-tiers.mjs
bash scripts/check-spec-refs.sh
bash scripts/check-spec-update.sh
```

コミット → プッシュ → Vercel 再デプロイで `GET /` の 200 応答を確認する。

## 変更対象ファイル

| ファイル                    | 内容                                                                              |
| --------------------------- | --------------------------------------------------------------------------------- |
| `src/app/actions.ts`        | 新規。Server Actions（setSourceCookie / handleSourceChange）                      |
| `src/app/page.tsx`          | `"use server"` 削除、レンダリング中の cookie 書き込み削除、actions.ts から import |
| `tests/app/actions.test.ts` | 新規。Server Action の単体テスト                                                  |
| `tests/app/page.test.tsx`   | 新規。RSC レンダリング中に cookie 書き込みがないことの検証                        |

---

## レビュー（2026-08-08 検証）

`pnpm build` → `pnpm start` → curl でローカル再現を取り、コード・スクリプト・
git 履歴と突き合わせた結果。

### 裏が取れた点

- **原因箇所は記載どおり正確**。`src/app/page.tsx:31-34` の
  `if (selectedSource !== savedSource) await setSourceCookie(...)` が該当。
- **混入コミットは `c0bba6f` で確定**。`git log -S '"use server"' -- src/app/page.tsx` と
  `git log -L 25,40:src/app/page.tsx` の両方が同コミットを指す。
  レンダリング中の cookie 書き込みと `"use server"` ディレクティブは同時に入った。
- **修正対象は page.tsx 1 ファイルのみ**。`src/` 全体で `"use server"` を含むファイルも、
  cookie を `.set()` するファイルも page.tsx だけ（grep 済み）。取りこぼしはない。
- **T1 の注記は正しい**。`fetch-button.tsx:21,24` は `onSourceChange` を props で受けており、
  actions.ts への移設で import 変更は発生しない。
- **検証コマンドはすべて実在**。`tsgo`（v7.0.0-dev）、`lint:fast`（oxlint）、
  `check-coverage-tiers.mjs`、`check-spec-refs.sh`、`check-spec-update.sh` いずれも動く。
- ローカル再現でログに出た文言は Vercel の報告と完全一致:
  `Error: Cookies can only be modified in a Server Action or Route Handler.`

### 要修正 1 — 「`GET /` が 500」は誤り。実測は **200**

ストリーミング開始後に throw されるため、Next.js はステータスを 500 に変えられない。
HTTP 200 のまま RSC ペイロード末尾に `13:E{"digest":"1656420235"}` が流れ、
クライアント側で `src/app/error.tsx` の境界が「エラーが発生しました」を描画する。

**そのため「検証」節の "`GET /` の 200 応答を確認する" は判定として機能しない**
（壊れている状態でも 200 が返る）。次のいずれかに差し替えること:

- レスポンス本文に記事一覧が含まれること（`/` で `News Watch` 見出しだけでなく記事カードが出る）
- サーバーログに `Cookies can only be modified` が出ないこと
- 本文に `E{"digest"` が含まれないこと

### 要修正 2 — 発生条件を明記すべき

実測（cookie / query の組み合わせ別、サーバーログのエラー増分で判定）:

| リクエスト                      | エラー | 結果                                |
| ------------------------------- | ------ | ----------------------------------- |
| cookie なし `GET /`             | 発生   | **初回訪問者は必ず壊れる**          |
| `cookie=zenn`・param なし       | なし   | 正常（記事も描画される。本文 35KB） |
| `cookie=zenn` + `?source=qiita` | 発生   | ソース切替時に壊れる                |

「常に 500」ではなく「`selectedSource !== savedSource` のときだけ壊れる」。
既存 cookie 保持者には再現しないため、この条件を書いておかないと修正確認時に
「直った」と誤判定しうる。

### 追記推奨

1. **T1: 両関数を `export` すること**を明記。page.tsx から `"use server"` を外すと、
   ローカル定義の関数は Client Component の prop に渡せない
   （Server Action として登録されるのは `"use server"` ファイルの **export** のみ）。
   ここが抜けるとランタイムでシリアライズエラーになる。
2. `handleSourceChange`（page.tsx:19-23）は `setSourceCookie` を呼ぶだけの空ラッパーで、
   コメントも実質無内容。actions.ts へ移す際に **1 本に統合**してよい。
   分けたままにするなら理由を書く。
3. **T3 は spec.md:322（Tier 7）と衝突**。同表は RSC ページを「単体テスト対象外／
   ロジックは Client Component に委譲されており単体テストは実質不可能」としている。
   `tests/app/page.test.tsx` を足すなら、回帰防止の例外である旨を spec.md 側にも反映する。
4. **静的検査テストを併用したい**。挙動テストは「`cookie.set` が呼ばれない」ことは検出できるが、
   **`page.tsx` に `"use server"` が再混入すること自体**は検出できない。
   本 repo は同種の問題に対し `tests/middleware-edge-compat.test.ts`（`c31a8be`）で
   すでに「ソースを静的に読んで禁止パターンを assert する」手法を確立している。
   同じ形で `src/app/page.tsx` が `"use server"` を含まないことを assert すれば
   再発を構造的に防げる。
5. `src/app/actions.ts` は `check-coverage-tiers.mjs` のどの Tier パターンにも一致せず、
   カバレッジゲートの対象外になる。意図的ならその旨を、そうでなければ Tier 5 の
   patterns に追加する。
6. **変更対象ファイル表に `openspec/specs/news-watch/spec.md` が漏れている**。
   `check-spec-update.sh` の `SPEC_SENSITIVE_PATTERNS` に `src/app/page.tsx` が
   含まれるため、spec.md を staged しないと commit 時に警告が出る（非ブロッキング）。
   spec.md:210 のルートツリー `├── / (src/app/page.tsx - RSC)` に actions.ts を
   併記するのが自然。

### 細かい指摘

- 案 C の却下理由「静的アセットの扱いに注意が必要」は実態と合わない。
  本 repo の middleware は matcher が `/admin/db/:path*` に限定されており、
  静的アセットは元から通らない。却下の結論（過剰）自体は妥当。
- 別件だが `pnpm build` で
  `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
  が出る（Next.js 16.2.10）。本修正のスコープ外だが、別タスクとして起票しておきたい。

---

## なぜ事前に検知できなかったか（2026-08-08 実測）

既存の検査層を 1 つずつ実行して確認した結果。

| 検査層                          | 実行タイミング           | 検知                  | 理由（実測）                                                                                                                              |
| ------------------------------- | ------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `tsgo --noEmit`                 | pre-commit               | ❌                    | `cookies()` の戻り値型に `.set()` は**存在する**。「Server Action / Route Handler 内でのみ可」はランタイム制約で、型に現れない            |
| `lint:fast`（oxlint）           | pre-commit               | ❌                    | 実測出力は `isPending` の unused 警告のみ。Server Action 境界を見るルールを持たない                                                       |
| **`pnpm lint`（eslint）**       | **どこでも実行されない** | **⚠️ 検知できていた** | 下記参照                                                                                                                                  |
| `vitest related`（lint-staged） | pre-commit               | ❌                    | `src/app/page.tsx` に対応するテストが 1 本も無く、`--passWithNoTests` で無言 pass                                                         |
| カバレッジ / Tier 検証          | pre-push                 | ❌                    | spec.md:322 の Tier 7 が RSC ページを「対象外」と宣言済み。測っていないので落ちようがない                                                 |
| `next build`                    | **どこでも実行されない** | ❌                    | 仮に走らせても通る。`/` は `ƒ (Dynamic)` でビルド時プリレンダされず、実測でも `✓ Compiled successfully`。エラーはリクエスト時にしか出ない |
| CI                              | **存在しない**           | ❌                    | `.github/` なし。Vercel のビルドだけが唯一の自動検査で、それは上記のとおり通る                                                            |

### 最大の穴 — ルールはあったのに、そのリンタが走っていない

`pnpm exec eslint src/app/fetch-button.tsx` を実行すると、まさに問題の境界を指すエラーが出る:

```
fetch-button.tsx:21:3  error
  Props must be serializable for components in the "use client" entry file.
  "onSourceChange" is a function that's not a Server Action.
  @sbougerel/next-use-client-boundary/props-must-be-serializable
```

`@sbougerel/eslint-plugin-next-use-client-boundary` は依存にも eslint.config.mjs にも
入っている。**にもかかわらず eslint は pre-commit にも pre-push にも lint-staged にも
CI にも入っていない**（フックが回すのは `lint:fast` = oxlint のみ）。
つまり「検知能力は持っていたが、一度も実行されなかった」。

### 挙動側の要因 — なぜ手動でも気付けなかったか

- **dev でも本番でも再現する**。`pnpm dev` では
  `at setSourceCookie (src/app/page.tsx:11:15)` / `at async Home (src/app/page.tsx:33:5)`
  という明確なスタックトレースが出る。cookie 無しで `/` を一度開いていれば必ず気付けた。
- **しかし `source` cookie を持っていると再現しない**。cookie はソースフィルタのクリック
  （Server Action 経由＝正規ルート）で正しく書かれるため、実装中に一度フィルタを操作すると
  以降 `/` は正常に描画される。典型的な "works on my machine"。
- **HTTP ステータスは 200 のまま**（レビュー節の要修正 1 参照）。
  ステータスコードの目視・監視では拾えない。

### 計画そのものの穴

- `10-phase3-plan.md` P3-1 の作業項目は「**ソース変更時**、Server Action で Cookie を書き、
  `router.push(?source=...)`」だけ。**レンダリング中の cookie 書き込み（page.tsx:31-34）は
  どのタスクにも対応しない、実装時のアドホックな追加**（「URL param と cookie がズレていたら
  同期する」という意図）。計画外のコードがレビューを素通りした。
- P3 の「完了条件」6 項目に「`/` が実際に記事を描画する」に相当するものが無い。
  しかも 1 番目の「初回描画でソースがちらつかない」はまさに **cookie 無しの初回ロード**の話で、
  これを実機で 1 回確認していれば確実に踏んでいた。✅ が付いているのは
  コード読みとユニットテストによる判定だったことを示唆する。

## 教訓と再発防止

1. **「ルールを持っているが走らせていない」を潰す（最優先）**。
   pre-push に `pnpm lint`（eslint）を追加する。ただし現状は全体で 253 problems
   （191 errors — 大半は `tests/` 配下の `any`）が残っているため、
   まず `src/` 限定で導入し、`tests/` は段階的に解消する。
2. **ビルドが通ることは動作の証明にならない**。動的ルートの実行時エラーは
   `next build` を素通りする。`pnpm build && pnpm start` → `curl /` →
   **本文に記事が含まれるか**を見るスモークが 1 本あれば今回は確実に止まった。
3. **HTTP 200 を成功指標にしない**。判定は本文の内容か、サーバーログに
   エラーが出ていないことで行う。レビュー節の「要修正 1」と同根の問題。
4. **Tier 7「RSC ページは単体テスト対象外」が事実上「検証しない」になっていた**。
   ロジックの無いページには妥当だが、`page.tsx` は cookie・searchParams・DB を
   束ねる唯一の結合点で、実質ロジックがある。方針を
   「**ユニットテスト対象外。ただしスモーク検証は必須**」に改め、spec.md §7.1 に明記する。
5. **永続状態（cookie / localStorage）に依存する機能はクリーンな状態で確認する**。
   検証手順に「シークレットウィンドウ、または `source` cookie を削除してから」と書く。
6. **計画に無いコードが入ったら計画を更新する**。差分レビュー時に
   「この行はどのタスク由来か」を問えば page.tsx:31-34 は拾えた。
7. **同型の不具合はこれが 3 度目**。`08-verification-report.md` が
   「検証が実は効いていない」構造を指摘し、`11-09-verification.md` が
   「5 点中 2 点はその再発」と記録し、`c31a8be`（edge ランタイム互換）も同型
   ——「Node で走るテストは edge の問題を検出できない」。
   共通の失敗パターンは **検査が本番と違う条件で走っている／そもそも走っていない**。
   個別テストの追加で終わらせず、変更時に次を自問するチェックリストを設ける:
   - その検査は**実際に実行される**経路（フック / CI）に入っているか
   - その検査は**本番と同じ条件**（ランタイム・ビルドモード・初期状態）で走るか

### 推奨アクション

| #   | 内容                                                                               | 対象                                    |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------- |
| A1  | pre-push に `pnpm exec eslint src/` を追加                                         | `.husky/pre-push`                       |
| A2  | `pnpm build && pnpm start` + `/` スモーク（本文に記事が出ることを確認）を手順化    | `.husky/pre-push` or 手動チェックリスト |
| A3  | Tier 7 の記述を「単体テスト対象外／スモーク必須」に改訂                            | `openspec/specs/news-watch/spec.md:322` |
| A4  | `page.tsx` に `"use server"` が無いことの静的 assert（レビュー節 追記推奨 4）      | `tests/app/`                            |
| A5  | CI（GitHub Actions）の新設を検討。現状フックのみで、`--no-verify` で全て迂回できる | `.github/workflows/`                    |
