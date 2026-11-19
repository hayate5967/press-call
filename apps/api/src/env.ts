// Hono の環境の型（Worker のバインディングと、ミドルウェアがリクエストに載せる値）
import type { Db } from "./db/client";
import type { DeviceContext } from "./services/sets";

export type Bindings = {
  ASSETS: Fetcher;
  /** Neon への接続プール（wrangler.jsonc の hyperdrive） */
  HYPERDRIVE: Hyperdrive;
  /** 動いている環境。wrangler.jsonc では production、手元の .dev.vars で development に上書きする */
  ENVIRONMENT: "development" | "production";
  /** Google OAuth のクライアント（秘密。.dev.vars / wrangler secret） */
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** アクセストークン（JWT）の署名に使う ES256 の秘密鍵（JWK の JSON。秘密） */
  JWT_PRIVATE_JWK: string;
  /** 外から見たオリジン（任意）。手元の開発で Vite 経由にするとき http://localhost:5173 を入れる */
  PUBLIC_ORIGIN?: string;
  /** 手元の開発だけで使う Neon の開発用ブランチ（.dev.vars）。ENVIRONMENT=development のときだけ使う */
  DATABASE_URL?: string;
};

/** アクセストークンで確認できたユーザー */
export type UserContext = { userId: string };

export type Variables = {
  db: Db;
  device: DeviceContext;
  user: UserContext;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
