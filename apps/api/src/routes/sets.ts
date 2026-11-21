// セットの API（Web アプリ向け、API 仕様書 6 章）
// すべて user 認証。他人のセットの ID を指定されたら 404
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { newSetListSchema, setDetailSchema, updateSetInputSchema } from "@press-call/shared";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../env";
import { userAuth } from "../middleware/auth-user";
import { payloadTooLarge, problemResponse, validationHook } from "../middleware/error";
import { deleteSet, getSetDetail, listNewSets, patchSet } from "../services/set-details";

const setIdParams = z.object({
  setId: z.uuid().openapi({ param: { name: "setId", in: "path" } }),
});

const unauthorized = problemResponse(
  "ログインしていない（token_missing・token_expired・token_invalid）",
);
const notFound = problemResponse("セットがない・他人のセット・削除したセット（not_found）");

/** PATCH の本文の上限。メモ 500 文字（UTF-8 で最大 1.5KB 程度）に余裕を持たせる */
const PATCH_MAX_BYTES = 8 * 1024;

const newSetsRoute = createRoute({
  method: "get",
  path: "/sets",
  tags: ["セット"],
  summary: "新しく届いたセット（練習中の自動更新用）",
  description:
    "Web アプリが練習中に数秒おきに呼ぶ。次の createdAfter にはレスポンスの serverTime をそのまま渡す" +
    "（スマホとサーバの時計のずれを避けるため）。serverTime は登録途中のセットを取りこぼさないよう少し前にずらしてあるので、" +
    "同じセットが続けて返ることがある（ID で重複を除く）。createdAfter を付けなければ、セットは返さず serverTime だけを返す",
  middleware: [userAuth] as const,
  request: {
    query: z.object({
      createdAfter: z.iso
        .datetime()
        .optional()
        .openapi({ param: { name: "createdAfter", in: "query" } }),
    }),
  },
  responses: {
    200: {
      description: "createdAfter より後に届いたセット（届いた順、最大 50 件）",
      content: { "application/json": { schema: newSetListSchema } },
    },
    401: unauthorized,
    422: problemResponse("createdAfter が ISO 8601 の日時でない（validation_failed）"),
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/sets/{setId}",
  tags: ["セット"],
  summary: "セットの詳細（使った設定・各レップの全項目と速度カーブ）",
  middleware: [userAuth] as const,
  request: {
    params: setIdParams,
  },
  responses: {
    200: {
      description: "レップは 1 レップ目から",
      content: { "application/json": { schema: setDetailSchema } },
    },
    401: unauthorized,
    404: notFound,
  },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/sets/{setId}",
  tags: ["セット"],
  summary: "重量・RPE・メモの入力・編集",
  description:
    "送った項目だけ変わり、null を送ると空に戻る。weightKg は 0〜500・0.5 刻み、rpe は 1〜10・0.5 刻み、note は 500 文字まで",
  middleware: [
    userAuth,
    bodyLimit({ maxSize: PATCH_MAX_BYTES, onError: payloadTooLarge }),
  ] as const,
  request: {
    params: setIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateSetInputSchema } },
    },
  },
  responses: {
    200: {
      description: "更新後のセット",
      content: { "application/json": { schema: setDetailSchema } },
    },
    401: unauthorized,
    404: notFound,
    413: problemResponse("本文が大きすぎる（payload_too_large）"),
    422: problemResponse("入力ルール違反（validation_failed）"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/sets/{setId}",
  tags: ["セット"],
  summary: "セットの削除",
  description:
    "レップと生データを消し、セットは削除済みにする。同じ clientSetId がデバイスから再送されても復活しない。" +
    "有効なセットが 0 件になった練習日は、練習日の一覧に出なくなる",
  middleware: [userAuth] as const,
  request: { params: setIdParams },
  responses: {
    204: { description: "削除した" },
    401: unauthorized,
    404: notFound,
  },
});

export const setsRoutes = new OpenAPIHono<AppEnv>({ defaultHook: validationHook })
  .openapi(newSetsRoute, async (c) => {
    const { createdAfter } = c.req.valid("query");
    c.header("Cache-Control", "no-store");
    return c.json(await listNewSets(c.var.db, c.var.user.userId, createdAfter), 200);
  })
  .openapi(detailRoute, async (c) => {
    const { setId } = c.req.valid("param");
    return c.json(await getSetDetail(c.var.db, c.var.user.userId, setId), 200);
  })
  .openapi(patchRoute, async (c) => {
    const { setId } = c.req.valid("param");
    const set = await patchSet(c.var.db, c.var.user.userId, setId, c.req.valid("json"));
    return c.json(set, 200);
  })
  .openapi(deleteRoute, async (c) => {
    const { setId } = c.req.valid("param");
    await deleteSet(c.var.db, c.var.user.userId, setId);
    return c.body(null, 204);
  });
