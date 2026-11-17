// Hono の環境の型（Worker のバインディングと、ミドルウェアがリクエストに載せる値）
import type { Db } from "./db/client";
import type { DeviceContext } from "./services/sets";

export type Bindings = {
  ASSETS: Fetcher;
  /** Neon への接続プール（wrangler.jsonc の hyperdrive） */
  HYPERDRIVE: Hyperdrive;
  /** 動いている環境。wrangler.jsonc では production、手元の .dev.vars で development に上書きする */
  ENVIRONMENT: "development" | "production";
};

export type Variables = {
  db: Db;
  device: DeviceContext;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
