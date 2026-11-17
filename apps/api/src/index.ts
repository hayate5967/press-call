// Worker の入口。/api/v1 以下を Hono が処理し、それ以外は静的ファイル（Web アプリ）が返る
import { OpenAPIHono } from "@hono/zod-openapi";
import { openDb } from "./db/client";
import type { AppEnv } from "./env";
import { type OpenDb, withDb } from "./middleware/db";
import { onError, onNotFound } from "./middleware/error";
import { device } from "./routes/device";
import { health } from "./routes/health";

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

/** アプリを組み立てる。テストでは DB の開き方（PGlite）を差し替える */
export function createApp(options: { openDb: OpenDb } = { openDb: openHyperdrive }) {
  const api = new OpenAPIHono<AppEnv>();

  // DB を使うルートの前で接続する（health は DB を使わない）
  api.use("/device/*", withDb(options.openDb));

  api.route("/", health);
  api.route("/", device);

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
