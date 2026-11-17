// Hono の環境の型（Worker のバインディングと、ミドルウェアがリクエストに載せる値）
import type { Db } from "./db/client";
import type { DeviceContext } from "./services/sets";

export type Bindings = {
  ASSETS: Fetcher;
  /** Neon への接続プール（wrangler.jsonc の hyperdrive） */
  HYPERDRIVE: Hyperdrive;
  /** 動いている環境。wrangler.jsonc では production、手元の .dev.vars で development に上書きする */
  ENVIRONMENT: "development" | "production";
  /**
   * 【ステップ3で削除】仮のデバイス。デバイストークン認証に置き換えるまでの一時的なもの。
   * ENVIRONMENT=development のときだけ効く。.dev.vars にだけ書き、本番には登録しない
   */
  DEV_DEVICE_ID?: string;
};

export type Variables = {
  db: Db;
  device: DeviceContext;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
