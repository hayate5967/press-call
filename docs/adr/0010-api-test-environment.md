# ADR-0010: API のテスト環境

- 状態：承認
- 日付：2026-11-17

## 背景

技術選定では、API のテストを @cloudflare/vitest-pool-workers（Workers のランタイム workerd の中で Vitest を動かす）で行う予定だった。

セット登録（`POST /device/sets`）から DB を使うようになり、冪等性（UNIQUE 制約と `ON CONFLICT`）、練習日の自動作成、トランザクション、CHECK 制約を、本物の PostgreSQL で確かめる必要が出てきた。テストのたびに Neon につなぐと、ネット接続と接続文字列（秘密情報）が CI に必要になる。

## 選択肢

| 選択肢 | 良い点 | 気になる点 |
| --- | --- | --- |
| vitest-pool-workers ＋ Neon の開発用ブランチ | 本番と同じランタイム・同じ DB | テストにネット接続と DATABASE_URL が要る。CI に秘密情報を置く。テスト同士がデータを共有して不安定になりやすい |
| vitest-pool-workers ＋ PGlite | ランタイムは本番と同じ | PGlite（WASM の PostgreSQL）はファイルシステムや大きな WASM の読み込みを前提にしており、workerd の中では動かしにくい |
| Node 上の Vitest ＋ PGlite | ネット接続も秘密情報も不要。テストごとに空の本物の PostgreSQL を作れる。速い | Workers 固有の挙動（バインディング、`nodejs_compat`、バンドル）はテストで確かめられない |
| Node 上の Vitest ＋ DB をモック | 最も速い | UNIQUE 制約による冪等性など、肝心の DB の振る舞いを確かめられない |

## 決定

API のテストは Node 上の Vitest で動かし、DB は PGlite を使う。テスト用のアプリは `createApp({ openDb })` で DB の開き方だけを差し替え、マイグレーション（`apps/api/drizzle`）を流してから使う。

Workers 固有の確認は次で担保する。

- CI の `wrangler deploy --dry-run`：Worker としてバンドルできること（Node 専用の API に依存していないこと）
- `wrangler dev` と本番へのデプロイ後の動作確認：Hyperdrive 経由で Neon につながること

## 理由

この API で壊れると困るのは「再送で二重にならない」「同じ日が 1 つにまとまる」といった DB の振る舞いで、これは本物の PostgreSQL でないと確かめられない。PGlite なら CI に秘密情報を置かずにそれができる。一方、Workers のランタイムの違いで壊れやすいのはバンドルと接続まわりで、これは dry-run とデプロイで十分に気づける。

## 影響

- テストはネット接続なしで、CI でもそのまま動く。
- `src/` のコードは Node と Workers の両方で動く書き方に限る（Workers にない Node の API は使わない。dry-run で気づける）。
- PGlite は接続が 1 本なので、同時に届いたリクエストの本当の競合は再現できない。競合への備えは DB の UNIQUE 制約と `ON CONFLICT` で行い、テストではなくコードレビューで確認する。
- 見直す条件：Workers でしか起きない不具合が続いたら、vitest-pool-workers で動かすテストを別に足す。
