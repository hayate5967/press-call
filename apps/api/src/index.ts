// Worker の入口。/api/v1 以下を Hono が処理し、それ以外は静的ファイル（Web アプリ）が返る
import { OpenAPIHono } from "@hono/zod-openapi";
import { onError, onNotFound } from "./middleware/error";
import { health } from "./routes/health";

export type Bindings = {
  ASSETS: Fetcher;
};

const api = new OpenAPIHono<{ Bindings: Bindings }>();

api.route("/", health);

// OpenAPI（API 仕様書と突き合わせるための自動生成）
api.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "press-call API", version: "1.0.0" },
});

export const app = new OpenAPIHono<{ Bindings: Bindings }>().basePath("/api/v1");
app.route("/", api);
app.onError(onError);
app.notFound(onNotFound);

export default app;
