# press-call

ベンチプレスの胸上での静止を ESP32 で検知して「Press」合図を出し、レップの記録をクラウドに自動保存する個人開発アプリ。

## 構成

- `firmware/` — ESP32-WROOM-32E + MPU-6050（PlatformIO / Arduino）
  - `lib/detection/` 判定ロジック（PauseDetector, VelocityEstimator）。Arduino 非依存の純 C++。PC 上でテストする
  - `src/main.cpp` センサー読み取り・ブザー・シリアル出力
  - ピン: SDA=21, SCL=22, ブザー=GPIO18（LOW で鳴る）, LED=GPIO2
- `apps/api/` — Hono + @hono/zod-openapi（Zod 4）on Cloudflare Workers
  - DB: Neon (PostgreSQL) を Hyperdrive 経由で使う。ORM は Drizzle、マイグレーションは drizzle-kit
  - エラー応答は RFC 9457（application/problem+json）
  - OpenAPI は `/api/v1/openapi.json`
- `apps/web/` — Vite + React の SPA。API と同じ Worker から配信（`/api/*` は Worker、それ以外は SPA）
- `packages/shared/` — API とフロントで共有する Zod スキーマ
- `docs/` — ADR（`docs/adr/`）、ER 図（`docs/er.md`）、要件・API 仕様など

## 設計の決定事項（変える場合は先に相談し、ADR を追加する）

- 判定（静止検知・合図）はデバイス内で完結させる。サーバに依存しない
- ネットワークは iPhone テザリング（2.4GHz）。eduroam や大学の認証情報はデバイスに入れない
- セット送信は clientSetId で冪等にする。送信失敗時は LittleFS に保存して再送
- ユーザ認証: Google OAuth（Arctic, PKCE）→ 自前 JWT（jose, ES256, 短期アクセストークン）＋リフレッシュトークンのローテーション
- デバイス認証: ペアリング（RFC 8628 方式、`http://bench.local` にコード表示）→ 不透明なデバイストークン
- リフレッシュトークンとデバイストークンは DB にハッシュだけ保存する。平文は保存しない
- 認可: 全クエリを持ち主の user_id で絞る。他人のリソースは 404 を返す
- 1デバイス = 1ユーザ。重量は kg のみ。同じ日のセットは自動で1つのセッションにまとめる

## 秘密情報

- API の秘密は `apps/api/.dev.vars`、ファームは `firmware/include/secrets.h`。どちらも gitignore 済み
- コミットしてよいのは `*.example` だけ。秘密情報をコードやログに書かない

## コマンド

```bash
pnpm install
pnpm lint          # Biome
pnpm typecheck
pnpm test          # Vitest
pnpm --filter web build

cd firmware
~/.platformio/penv/bin/pio test -e native   # 判定ロジックのテスト
~/.platformio/penv/bin/pio run -e esp32dev  # ESP32 向けビルド
```

## 進め方のルール

- 作業前に関連する docs（ADR、ER 図、API 仕様）と既存コードを読む
- 1ステップずつ進め、変更ごとにテストを書いて lint / typecheck / test を通す
- 仕様と実装が食い違ったら、勝手に決めずに確認する
- 説明は日本語で、初学者にもわかるように。何を・なぜ変えたかを最後に短くまとめる
- コミットは指示があったときだけ行う
