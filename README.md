# press-call

ベンチプレスで胸の上の静止を検知して **Press 合図** を出し、セットの記録（レップ数・速度・静止時間）を手入力なしで残すアプリです。

- **デバイス**：ESP32＋MPU-6050＋ブザー。部室に常設し、静止を判定してブザーと LED で合図する
- **Web アプリ**：iPhone のブラウザで使う唯一の画面。設定の変更、記録の確認・編集・削除
- **API**：Hono（TypeScript）on Cloudflare Workers。DB は Neon（PostgreSQL）
- **認証**：Google OAuth（Arctic）＋自前 JWT。デバイスは RFC 8628 方式でペアリング

設計の詳細は [docs/](./docs/README.md) を参照してください。

## 構成

```
press-call/
├─ apps/
│  ├─ api/          Hono（Cloudflare Workers）。Web アプリのビルド結果もここから配信する
│  └─ web/          Vite＋React
├─ packages/
│  └─ shared/       API と Web アプリで共有する Zod スキーマ
├─ firmware/        ESP32（PlatformIO＋Arduino）
├─ docs/            設計ドキュメントと ADR
└─ .github/workflows/ci.yml
```

## 必要なもの

- Node.js 22 以上（`.nvmrc`）
- pnpm 10（`corepack enable` で使える）
- PlatformIO（`pip install platformio`。ファームを触るときだけ）

## 手元で動かす

```bash
corepack enable
pnpm install

# ターミナル 1：API（http://localhost:8787）
pnpm dev:api

# ターミナル 2：Web アプリ（http://localhost:5173。/api は API に転送される）
pnpm dev:web
```

ブラウザで http://localhost:5173 を開き、「API に接続しました」と出れば成功です。

### チェック（CI と同じ内容）

```bash
pnpm lint        # Biome による lint と整形のチェック（直すときは pnpm format）
pnpm typecheck   # 型チェック
pnpm test        # テスト
```

### ファームウェア

```bash
cd firmware
cp include/secrets.example.h include/secrets.h   # 値を入れる（Git には入らない）
pio test -e native         # 判定ロジックのテスト（PC 上）
pio run -e esp32dev -t upload   # ESP32 に書き込み
pio device monitor         # シリアル出力（生データの CSV）を見る
```

## 秘密情報

- API：`apps/api/.dev.vars.example` を `.dev.vars` にコピーして値を入れる。本番は `wrangler secret put`
- ファーム：`firmware/include/secrets.example.h` を `secrets.h` にコピー
- どちらも `.gitignore` 済み。サンプル（`*.example*`）だけをコミットする
