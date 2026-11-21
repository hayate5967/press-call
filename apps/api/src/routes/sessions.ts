// 練習日の API（Web アプリ向け、API 仕様書 6 章、FR-V01）
// すべて user 認証。他人の練習日の ID を指定されたら 404
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  SESSION_LIST_DEFAULT_LIMIT,
  SESSION_LIST_MAX_LIMIT,
  sessionDetailSchema,
  sessionListSchema,
} from "@press-call/shared";
import type { AppEnv } from "../env";
import { userAuth } from "../middleware/auth-user";
import { problemResponse, validationHook } from "../middleware/error";
import { decodeCursor, getSessionDetail, listSessions } from "../services/sessions";

const unauthorized = problemResponse(
  "ログインしていない（token_missing・token_expired・token_invalid）",
);

const listQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SESSION_LIST_MAX_LIMIT)
    .default(SESSION_LIST_DEFAULT_LIMIT)
    .openapi({ param: { name: "limit", in: "query" } }),
  cursor: z
    .string()
    .max(200)
    .refine((c) => decodeCursor(c) !== null, "前のページの nextCursor をそのまま渡してください")
    .optional()
    .openapi({ param: { name: "cursor", in: "query" } }),
});

const listRoute = createRoute({
  method: "get",
  path: "/sessions",
  tags: ["練習日"],
  summary: "練習日の一覧（新しい順）",
  description:
    "削除していないセットが 1 つ以上ある練習日だけを返す。続きは nextCursor を cursor に渡して取る",
  middleware: [userAuth] as const,
  request: { query: listQuery },
  responses: {
    200: {
      description: "練習日の一覧",
      content: { "application/json": { schema: sessionListSchema } },
    },
    401: unauthorized,
    422: problemResponse("limit が範囲外・cursor の形が違う（validation_failed）"),
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/sessions/{sessionId}",
  tags: ["練習日"],
  summary: "練習日のセットとレップ（速度分布用、速度カーブは含めない）",
  middleware: [userAuth] as const,
  request: {
    params: z.object({
      sessionId: z.uuid().openapi({ param: { name: "sessionId", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "セットは挙げた順、レップは 1 レップ目から",
      content: { "application/json": { schema: sessionDetailSchema } },
    },
    401: unauthorized,
    404: problemResponse("練習日がない・他人の練習日・セットがすべて削除された練習日（not_found）"),
  },
});

export const sessionsRoutes = new OpenAPIHono<AppEnv>({ defaultHook: validationHook })
  .openapi(listRoute, async (c) => {
    const { limit, cursor } = c.req.valid("query");
    return c.json(await listSessions(c.var.db, c.var.user.userId, { limit, cursor }), 200);
  })
  .openapi(detailRoute, async (c) => {
    const { sessionId } = c.req.valid("param");
    return c.json(await getSessionDetail(c.var.db, c.var.user.userId, sessionId), 200);
  });
