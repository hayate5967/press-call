// Worker の入口。/api/v1 以下を Hono が処理し、それ以外は静的ファイル（Web アプリ）が返る
import { OpenAPIHono } from "@hono/zod-openapi";
import { openDb } from "./db/client";
import type { AppEnv } from "./env";
import { type CreateGoogle, createArcticGoogle } from "./lib/google";
import { type OpenDb, withDb } from "./middleware/db";
import { onError, onNotFound } from "./middleware/error";
import { authRoutes, callbackErrorsToLogin } from "./routes/auth";
import { device } from "./routes/device";
import { devicesRoutes } from "./routes/devices";
import { health } from "./routes/health";
import { pairing } from "./routes/pairing";

export type { Bindings } from "./env";

/** 本番・wrangler dev では Hyperdrive 経由で Neon につなぐ */
const openHyperdrive: OpenDb = (env) => {
  // wrangler.jsonc に hyperdrive がないのは設定の誤り。503 ではなく 500 にして気づけるようにする
  if (!env.HYPERDRIVE) {
    throw new Error(
      "HYPERDRIVE バインディングがありません（wrangler.jsonc の hyperdrive を設定する）",
    );
  }
  return openDb(env.HYPERDRIVE.connectionString);
};

export type AppOptions = {
  openDb: OpenDb;
  /** Google OAuth の実装。テストでは偽物に差し替える */
  createGoogle: CreateGoogle;
};

/** アプリを組み立てる。テストでは DB の開き方（PGlite）と Google を差し替える */
export function createApp(overrides: Partial<AppOptions> = {}) {
  const options: AppOptions = {
    openDb: openHyperdrive,
    createGoogle: createArcticGoogle,
    ...overrides,
  };
  const api = new OpenAPIHono<AppEnv>();

  // Google からの戻りで起きたエラー（DB の接続失敗も含む）はログイン画面へ。withDb より前に置く
  api.use("/auth/google/callback", callbackErrorsToLogin);

  // DB を使うルートの前で接続する（health と /auth/google/start は DB を使わない）
  const db = withDb(options.openDb);
  for (const path of [
    "/device/*",
    "/auth/google/callback",
    "/auth/refresh",
    "/auth/logout",
    "/me",
    "/pairings/*",
    "/devices",
    "/devices/*",
  ]) {
    api.use(path, db);
  }

  api.route("/", health);
  api.route("/", device);
  api.route("/", authRoutes(options.createGoogle));
  api.route("/", pairing);
  api.route("/", devicesRoutes);

  // OpenAPI（API 仕様書と突き合わせるための自動生成）
  api.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "press-call API", version: "1.0.0" },
  });

  const app = new OpenAPIHono<AppEnv>().basePath("/api/v1");
  app.route("/", api);
  app.onError(onError);
  app.notFound(onNotFound);
  return app;
}

export const app = createApp();

export default app;
