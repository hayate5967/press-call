# ベンチプレス静止感知アプリ 技術選定（ADR）

Nov 13, 2026 · @Kato Hayate

## 1. 結論

**すべて無料枠で月 0 円で運用できる。** API と閲覧画面を 1 つの Cloudflare Worker にまとめ、DB は Neon の PostgreSQL を使う。認証は Google ログイン部分だけライブラリ（Arctic）に任せ、JWT とリフレッシュトークンは自分で設計・実装する。

| 領域 | 採用 | 月額 |
| --- | --- | --- |
| API | Hono（TypeScript）on Cloudflare Workers | 0 円 |
| DB | Neon（PostgreSQL）＋ Cloudflare Hyperdrive（接続プール） | 0 円 |
| 閲覧画面 | Vite＋React（SPA）、shadcn/ui・Tailwind CSS・Recharts。API と同じ Worker から配信 | 0 円 |
| ユーザー認証 | Arctic（Google OAuth・PKCE）＋自前 JWT（jose）＋リフレッシュトークンのローテーション | 0 円 |
| デバイス認証 | ランダムな不透明トークン（DB にはハッシュだけ保存） | — |
| ORM・マイグレーション | Drizzle ORM＋drizzle-kit | — |
| API 仕様 | @hono/zod-openapi（コードから OpenAPI を自動生成） | — |
| テスト | Vitest（API・Web）、PlatformIO の native テスト（判定ロジック） | — |
| ファーム | PlatformIO＋Arduino フレームワーク | — |
| CI | GitHub Actions | 0 円 |
| リポジトリ | pnpm workspaces のモノレポ | — |

有料になりうるのは、独自ドメインを使う場合（任意）だけ。

## 2. ADR-007a：DB — Neon を採用

**決定**：Neon の Free プラン。無期限で無料、使わないときは自動で停止（scale to zero）するので、このアプリのように「練習後に数回書き込むだけ」の使い方に合う。

| 観点 | Neon Free | Supabase Free | Render Free | Fly.io |
| --- | --- | --- | --- | --- |
| 月額 | 0 円（カード不要） | 0 円 | 0 円 | 無料枠なし。Managed Postgres は月 38 ドル〜 |
| 容量 | 1 プロジェクト 1GB（公式 FAQ、2026年10月時点） | 500MB | 1GB | — |
| 計算資源 | 月 100 CU時間。無操作 5 分で停止し、停止中は消費しない | 共有 | 共有 | — |
| 使わないとき | 自動停止。次のアクセスで数秒で起動 | **7日間アクセスがないと一時停止。管理画面から手動で再開が必要** | — | — |
| 期限 | なし | なし | **作成から 30 日で期限切れ。その後削除** | — |
| 素の PostgreSQL として使えるか | 使える | 使える（認証など付属機能は使わない） | 使える | 使える |
| 開発で便利な点 | ブランチ（DB のコピー）でマイグレーションを試せる | 管理画面が充実 | — | — |
| 判定 | **採用** | 次点。テスト期間や大会前後で 1 週間以上使わないと止まるのが痛い | 不採用 | 不採用 |

**容量の見積もり**：生データを DB に入れると、1 セット 30 秒×100Hz×6 軸で約 1.8 万値になる。圧縮したバイナリ（bytea）で持てば 1 セット数十KB なので、週 20 セットでも 1GB には数年届かない。生データの持ち方は ADR-009（ER 図と一緒に決める）で最終決定する。

**影響**：停止からの初回アクセスは数秒遅い。デバイスの送信はタイムアウトを長め（例：15秒）にし、失敗したら再送する。

## 3. ADR-007b：API のホスティング — Cloudflare Workers を採用

**決定**：Cloudflare Workers（Free）。Hono はもともと Workers 向けに作られていて相性がよく、起動が速く、クレジットカードなしで使える。Neon へは Hyperdrive（Workers に含まれる接続プール）経由で接続する。

| 観点 | Cloudflare Workers Free | Google Cloud Run | Render Free |
| --- | --- | --- | --- |
| 無料枠 | 1日 10 万リクエスト | 月 200 万リクエスト、CPU 18 万 vCPU秒 | 月 750 時間 |
| カード登録 | 不要 | 必要（超過分は自動で課金） | 不要 |
| 起動の遅さ | ほぼなし | 数秒 | **15 分無操作で停止し、復帰に約 1 分** |
| 制約 | **1 リクエストあたり CPU 10ms**（DB や通信の待ち時間は含まない）。Node.js の全 API は使えない | コンテナなので制約が少ない | 制約は少ない |
| Hono との相性 | 最もよい（公式テンプレートあり） | よい（Node.js で動かす） | よい |
| 画面の配信 | 同じ Worker から静的ファイルを配信できる（無料・無制限） | 可能 | 可能 |
| 判定 | **採用** | 次点。CPU 10ms が足りないときの移行先 | 不採用（復帰 1 分はデバイスの送信でタイムアウトしやすい） |

**画面と API を同じ Worker にする理由**：リフレッシュトークンを HttpOnly Cookie に入れるとき、画面と API が別ドメイン（例：`*.pages.dev` と `*.workers.dev`）だとサードパーティ Cookie 扱いになり、Safari などでブロックされる。同じオリジンにすれば CORS も不要になる。

**影響**：CPU 10ms に収めるため、JWT の署名は Web Crypto を使うライブラリ（jose）にする。速度カーブなどの重い計算はデバイス側で済ませ、API は受け取って保存するだけにする。生データの大きな JSON を解析すると制限を超える恐れがあるので、生データはバイナリのまま保存する前提で設計する。

## 4. ADR-008：閲覧画面 — Vite＋React を採用

**決定**：Vite＋React の SPA。**画面がモダンに見えるかどうかは、Next.js かどうかではなく UI ライブラリで決まる。** shadcn/ui＋Tailwind CSS はどちらでも同じように使える。

| 観点 | Vite＋React（SPA） | Next.js |
| --- | --- | --- |
| 見た目 | shadcn/ui＋Tailwind で同等 | shadcn/ui＋Tailwind で同等 |
| 強みが活きるか | ログイン後に使う自分用の画面なので、SPA で十分 | SSR・SEO・サーバーコンポーネントが強みだが、今回は使いどころが少ない |
| API との役割分担 | Hono が API、React は画面だけ。責任がはっきり分かれる | Next.js 自体もサーバーになるため、Hono と役割がかぶる |
| デプロイ | ビルドした静的ファイルを Worker に置くだけ | Workers で動かすにはアダプタなど追加の設定が必要 |
| 認証との相性 | 自前 JWT の流れ（アクセストークンはメモリ、リフレッシュは Cookie）を素直に書ける | Next.js 側のミドルウェアと認証が二重になりやすい |
| 学習・ポートフォリオ | 「フロントと API を分離して設計した」と説明しやすい | 既存の作品と同じ構成になり、差分が出にくい |

**画面まわりの構成**：TanStack Router（ルーティング）、TanStack Query（API のデータ取得とキャッシュ）、Recharts（速度カーブと速度分布のグラフ）。

**画面はこの Web アプリ 1 つだけ**：練習中もテザリング経由でこの画面を使う。ESP32 が配信するのは、初回設定用の小さな設定ページ（素の HTML、数 KB）だけ。

## 5. ADR-005：認証 — OAuth はライブラリ、JWT は自前

**決定**：Google とのやり取り（認可コード＋PKCE）は Arctic に任せる。その後の自分のサービスのトークン（JWT とリフレッシュトークン）は自分で設計・実装する。「複雑で間違えると危険な部分は実績のあるものを使い、学びたい部分は自分で書く」という線引き。

| 観点 | Better Auth など全部入り | **Arctic＋自前 JWT** | 全部自前 |
| --- | --- | --- | --- |
| 実装の楽さ | 最も楽。セッション管理まで完成している | 中くらい | 大変 |
| JWT を自分で設計できるか | ライブラリの仕組みに乗るため、設計の余地が少ない | **できる** | できる |
| セキュリティ上の危険 | 少ない | 少ない。state・PKCE・ID トークンの検証など間違えやすい所はライブラリがやる | OAuth の細かい検証漏れが起きやすい |
| デバイス認証との統一 | ライブラリの外で別途作る必要 | 同じ設計方針で作れる | 同じ設計方針で作れる |
| 面接で話せること | 「ライブラリを入れた」で終わりやすい | トークン設計とその理由を話せる | 話せるが、安全性を説明しきれない恐れ |

### トークン設計（案）

| トークン | 形式 | 有効期限 | 保存場所 | 失効の仕方 |
| --- | --- | --- | --- | --- |
| アクセストークン | JWT（ES256 署名、中身はユーザー ID と有効期限程度） | 15 分 | ブラウザのメモリ（localStorage には置かない） | 期限切れを待つ（短いので許容） |
| リフレッシュトークン | ランダム文字列（不透明）。DB にはハッシュのみ | 30 日 | HttpOnly・Secure・SameSite=Strict の Cookie | 使うたびに新しいものと交換（ローテーション）。古いものが再利用されたら盗難とみなし、同じ系統をすべて失効 |
| デバイストークン | ランダム文字列（不透明）。DB にはハッシュのみ | 無期限 | ESP32 のフラッシュ | 管理画面から失効（FR-A04） |

**デバイストークンを JWT にしない理由**：JWT は署名だけで検証できる反面、発行後に取り消すことが難しい。部室に常設するデバイスは盗難時に即座に失効できることが重要なので、毎回 DB で確認する不透明トークンにする。一方でアクセストークンは期限を 15 分と短くして、「取り消せない」弱点を小さくする。この使い分け自体が設計の説明ポイントになる。

**ペアリングの方式**：ADR-006 として、API 仕様を書くときに決める。候補は、閲覧画面に出た短いコードを ESP32 の計測画面で入力する方式と、OAuth Device Authorization Grant（RFC 8628）に寄せた方式。

## 6. その他の選定

| 決めること | 採用 | 他の候補 | 理由 |
| --- | --- | --- | --- |
| ORM・マイグレーション | Drizzle ORM＋drizzle-kit | Prisma、Kysely | Workers でそのまま動き、SQL に近い書き方で型が付く。スキーマが TypeScript なので ER 図と突き合わせやすい |
| 入力の検証 | Zod | Valibot | Hono との連携が最も充実。画面と API で同じスキーマを共有できる |
| API 仕様書 | @hono/zod-openapi（コードから OpenAPI を生成し、Swagger UI で閲覧） | OpenAPI の YAML を先に手書き | 仕様書と実装がずれない。設計段階では先にエンドポイント一覧をドキュメントで合意してから書く |
| JWT ライブラリ | jose | hono/jwt | Web Crypto ベースで Workers 対応。ES256 や鍵の切り替え（kid）まで扱える |
| API・画面のテスト | Vitest（API は @cloudflare/vitest-pool-workers で本番に近い環境） | Jest | Vite と設定を共有でき、速い |
| Lint・整形 | Biome | ESLint＋Prettier | 1 つのツールで済み、設定が少なく速い |
| ファームの開発環境 | PlatformIO＋Arduino フレームワーク | ESP-IDF、Arduino IDE | 既存コードを流用でき、コマンドラインで CI に載せられる |
| ファームのテスト | 判定ロジックをハードに依存しない C++ に分け、PC 上で実行（PlatformIO の native 環境＋Unity） | 実機でのみ確認 | 記録した生データを入力にしたテストが CI で回せる（NFR-12） |
| CI | GitHub Actions | — | 公開リポジトリなら無料 |
| リポジトリ構成 | pnpm workspaces のモノレポ | リポジトリを分ける | API・画面・ファームで同じデータ形式を扱うので、型と仕様を 1 箇所に置きたい |

### リポジトリの構成（案）

```
bench-pause/
├─ apps/
│  ├─ api/        Hono（Workers）。ビルドした web もここから配信
│  └─ web/        Vite＋React
├─ packages/
│  └─ shared/     Zod スキーマ・型（API と画面で共有）
├─ firmware/      PlatformIO（src/ と test/）
├─ docs/
│  ├─ adr/        ADR を 1 件 1 ファイルで（0001-xxx.md）
│  └─ er.md       ER 図（Mermaid）
└─ .github/workflows/ci.yml
```

### CI で回すもの（最小限）

1. Biome による lint と整形チェック
2. TypeScript の型チェック（`tsc --noEmit`）
3. Vitest（API・画面）
4. ファームのビルド（`pio run`）と native テスト（`pio test -e native`）
5. マイグレーションが未生成のままになっていないかの確認（`drizzle-kit check`）

## 7. リスクと見直し条件

| リスク | 起きたときの対応 |
| --- | --- |
| 生データの受信で Workers の CPU 10ms を超える | 生データを別リクエストに分け、バイナリのまま保存する。それでも足りなければ Workers Paid（月 5 ドル）か Cloud Run に移る。Hono なのでコードの変更は少ない |
| Neon の 1GB を使い切る | 古い生データを削除するか、Cloudflare R2（無料枠 10GB）に移す |
| 無料枠の条件が変わる | 数字は 2026 年 11 月時点。年 1 回、各社の料金ページを確認する |
| ESP32 の HTTPS で証明書の検証がうまくいかない | Cloudflare のルート証明書をファームに埋め込む。検証を無効にする回避策は取らない（NFR-06） |
| Arctic の破壊的変更 | バージョンを固定し、依存更新は PR で確認する |

## 8. 出典

- [Neon：Free プランの制限](https://neon.com/faqs/free-plan-limits-and-quotas)
- [Neon：無料 Postgres の比較（自動停止について）](https://neon.com/faqs/managed-postgres-databases-free-tier)
- [Supabase Free の制限と一時停止（解説記事）](https://www.itpathsolutions.com/supabase-free-tier-limits)
- [Render：無料プラン](https://render.com/free)
- [Fly.io の 2026 年の料金（解説記事）](https://temps.sh/blog/fly-io-pricing-2026)
- [Cloudflare Workers：制限](https://developers.cloudflare.com/workers/platform/limits)
- [Cloudflare Hyperdrive：料金](https://developers.cloudflare.com/hyperdrive/platform/pricing)
- [Google Cloud Run：料金](https://cloud.google.com/run/pricing?hl=bg)
- [Arctic：Google プロバイダ](https://arcticjs.dev/providers/google)
