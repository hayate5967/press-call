// セットの API（Web アプリ向け、API 仕様書 6 章）
// すべて user 認証。他人のセットの ID を指定されたら 404
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { setDetailSchema } from "@press-call/shared";
import type { AppEnv } from "../env";
import { userAuth } from "../middleware/auth-user";
import { problemResponse, validationHook } from "../middleware/error";
import { getSetDetail } from "../services/set-details";

const detailRoute = createRoute({
  method: "get",
  path: "/sets/{setId}",
  tags: ["セット"],
  summary: "セットの詳細（使った設定・各レップの全項目と速度カーブ）",
  middleware: [userAuth] as const,
  request: {
    params: z.object({
      setId: z.uuid().openapi({ param: { name: "setId", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "レップは 1 レップ目から",
      content: { "application/json": { schema: setDetailSchema } },
    },
    401: problemResponse("ログインしていない（token_missing・token_expired・token_invalid）"),
    404: problemResponse("セットがない・他人のセット・削除したセット（not_found）"),
  },
});

export const setsRoutes = new OpenAPIHono<AppEnv>({ defaultHook: validationHook }).openapi(
  detailRoute,
  async (c) => {
    const { setId } = c.req.valid("param");
    return c.json(await getSetDetail(c.var.db, c.var.user.userId, setId), 200);
  },
);
